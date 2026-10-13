import type {Request,Response} from 'express';
import {createApp} from '../app/server/index.js';
let instance:ReturnType<typeof createApp>|undefined;
export default async function handler(req:Request,res:Response):Promise<void>{
  try{
    if(!instance)instance=createApp().catch(error=>{instance=undefined;throw error;});
    const {app}=await instance;
    await new Promise<void>((resolve,reject)=>{
      res.once('finish',resolve);
      res.once('error',reject);
      app(req,res);
    });
  }catch{
    res.setHeader('Cache-Control','no-store');
    res.status(503).json({error:'Hosted workspace setup is incomplete or its storage is temporarily unavailable.',code:'HOSTED_SETUP'});
  }
}
