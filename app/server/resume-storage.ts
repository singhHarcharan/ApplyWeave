import { AppError } from './model.js';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export function safeResumeFilename(filename: string): string {
  if (!filename || filename.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9_.() -]*\.pdf$/i.test(filename) || filename.includes('..')) {
    throw new AppError('Resume filename must be a safe PDF filename.', 400, 'INVALID_RESUME');
  }
  return filename;
}
export function validateResumePdf(data: Buffer): void {
  if (data.length < 8 || data.length > MAX_RESUME_BYTES || data.subarray(0,5).toString('ascii') !== '%PDF-') {
    throw new AppError('Resume must be a PDF no larger than 10 MB.', 400, 'INVALID_RESUME');
  }
}
/** Private object storage: never exposes a public bucket or signed public URL. */
export class SupabaseResumeStorage {
  private readonly base: string;
  constructor(url: string, private readonly key: string, readonly bucket = 'applyweave-resumes', private readonly fetcher: typeof fetch = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('SUPABASE_URL must be an HTTPS origin.');
    if (!key || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)) throw new Error('Private resume storage configuration is invalid.');
    this.base = parsed.origin + '/storage/v1';
  }
  static fromEnv(): SupabaseResumeStorage {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for hosted resumes.');
    return new SupabaseResumeStorage(url, key, process.env.SUPABASE_RESUME_BUCKET || 'applyweave-resumes');
  }
  private headers(extra: Record<string,string> = {}): Record<string,string> { return {apikey:this.key, Authorization:`Bearer ${this.key}`, ...extra}; }
  private objectUrl(filename: string): string { return `${this.base}/object/${this.bucket}/${encodeURIComponent(safeResumeFilename(filename))}`; }
  async ensurePrivateBucket(): Promise<void> {
    const response = await this.fetcher(`${this.base}/bucket/${this.bucket}`, {headers:this.headers(), signal:AbortSignal.timeout(20000)});
    if (response.ok) {
      const bucket = await response.json() as {public?:boolean};
      if (bucket.public !== false) throw new AppError('Resume bucket must be private. Disable public access before continuing.',503,'STORAGE_NOT_PRIVATE');
      return;
    }
    if (![400,404].includes(response.status)) throw new AppError('Could not verify private resume storage.',503,'STORAGE_UNAVAILABLE');
    const created = await this.fetcher(`${this.base}/bucket`, {method:'POST', headers:this.headers({'Content-Type':'application/json'}), body:JSON.stringify({id:this.bucket,name:this.bucket,public:false,file_size_limit:MAX_RESUME_BYTES,allowed_mime_types:['application/pdf']}),signal:AbortSignal.timeout(20000)});
    if (!created.ok) throw new AppError('Could not create private resume storage.',503,'STORAGE_UNAVAILABLE');
  }
  async upload(filename: string, data: Buffer): Promise<void> {
    const url = this.objectUrl(filename);
    validateResumePdf(data);
    // Refuse overwrite: retries verify existing bytes rather than replace candidate data.
    const response = await this.fetcher(url, {method:'POST', headers:this.headers({'Content-Type':'application/pdf','x-upsert':'false'}),body:new Uint8Array(data),signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      if ([400,409].includes(response.status)) {
        const existing = await this.download(filename);
        if (existing.equals(data)) return;
        throw new AppError('A different resume already exists with this filename. Use a new version filename.',409,'RESUME_CONFLICT');
      }
      throw new AppError('Could not upload resume to private storage.',503,'STORAGE_UNAVAILABLE');
    }
  }
  async download(filename: string): Promise<Buffer> {
    const response = await this.fetcher(this.objectUrl(filename),{headers:this.headers(),signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new AppError(response.status === 404 || response.status === 400 ? 'Resume not found.' : 'Private resume storage is unavailable.', response.status === 404 || response.status === 400 ? 404 : 503, response.status === 404 || response.status === 400 ? 'NOT_FOUND' : 'STORAGE_UNAVAILABLE');
    const length = Number(response.headers.get('content-length') || '0');
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (length > MAX_RESUME_BYTES || contentType !== 'application/pdf') throw new AppError('Stored resume is not a valid PDF.',503,'INVALID_RESUME');
    if (!response.body) throw new AppError('Stored resume is empty.',503,'INVALID_RESUME');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_RESUME_BYTES) { await reader.cancel(); throw new AppError('Stored resume exceeds the 10 MB limit.',503,'INVALID_RESUME'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const data = Buffer.concat(chunks);
    validateResumePdf(data);
    return data;
  }
}
