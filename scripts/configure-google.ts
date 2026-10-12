import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {GoogleOAuth} from '../app/server/google.js';
const [filename,spreadsheetId]=process.argv.slice(2);
if(!filename||!spreadsheetId){console.error('Usage: npm run configure-google -- /path/to/desktop-client.json SPREADSHEET_ID');process.exit(1);}
try {
 const client=JSON.parse(await readFile(filename,'utf8'));
 await new GoogleOAuth(fileURLToPath(new URL('../private/',import.meta.url))).configure(client,spreadsheetId);
 console.log('Google client saved privately. Open ApplyWeave and sign in with Google.');
} catch(error){console.error(error instanceof Error?error.message:'Configuration failed.');process.exitCode=1;}
