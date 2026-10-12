export const STATUSES = ['Saved', 'Preparing', 'Applied', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn'] as const;
export const ROLE_FAMILIES = ['Software Development Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Developer', 'AI Engineer', 'MERN Developer'] as const;
export const SOURCES = ['LinkedIn', 'Wellfound', 'Company portal', 'Referral', 'Other'] as const;
export const WORK_MODES = ['Remote', 'Hybrid', 'On-site', 'Unknown'] as const;

export type Status = typeof STATUSES[number];
export type SyncStatus = 'pending' | 'synced' | 'conflict';
export type Application = {
  applicationId: string; company: string; title: string; roleFamily: string; source: string;
  jobUrl: string; location: string; workMode: string; compensationLpa: number | null;
  dateSaved: string; dateApplied: string; status: Status; resumeVersion: string;
  answerPackId: string; nextAction: string; dueDate: string; lastUpdated: string;
  recruiter: string; responseDate: string; interviewDate: string; outcome: string;
  notes: string; jobDescription: string; syncStatus: SyncStatus;
};
export type ProfileExport = {
  schemaVersion: 1; profileVersion: string; personal: Record<string, string>;
  facts: Array<{id:string; claim:string; source:string}>;
  standardAnswers: Array<{key:string; text:string; factIds:string[]}>;
  resumeVersions: Array<{id:string; filename:string}>;
};
export type AnswerPack = {
  schemaVersion: 1; applicationId: string; profileVersion: string; resumeVersionId: string;
  analysis?: {fit:string; summary:string; resumeReason:string; proofPoints:Array<{text:string; factIds:string[]}>; unknowns:string[]; workModeCheck:string; compensationCheck:string};
  answers: Array<{question:string; answer:string; factIds:string[]; approved:boolean; maxCharacters?:number|null}>;
};
export type Preferences = Record<string, unknown>;
export type Conflict = {applicationId:string; message:string};
export type PublicState = {
  applications: Application[]; profile: ProfileExport; preferences: Preferences; packs: AnswerPack[];
  connection: {googleConfigured:boolean; googleConnected:boolean; googleEmail:string|null; spreadsheetId:string; aiAvailable:boolean; scriptAuthorized?:boolean; scriptInstalled?:boolean};
  lastSyncedAt:string|null; conflicts:Conflict[]; csrfToken:string; profileSyncStatus?:'local'|'synced'|'conflict';
};
