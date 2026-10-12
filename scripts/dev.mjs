import { spawn } from 'node:child_process';
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [spawn(command,['exec','--','tsx','watch','app/server/index.ts'],{stdio:'inherit'}),spawn(command,['exec','--','vite','--config','app/vite.config.ts','--host','127.0.0.1'],{stdio:'inherit'})];
let closing=false;
function stop(code=0){if(closing)return;closing=true;children.forEach(c=>c.kill('SIGTERM'));process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());children.forEach(c=>c.on('exit',code=>stop(code||0)));
