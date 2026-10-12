import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetsRequestError} from './sheets.js';

test('disabled Sheets API explains activation and provides an official project link',()=>{
 const error=sheetsRequestError(403,JSON.stringify({error:{details:[{reason:'SERVICE_DISABLED'}]}}),'123456789-test.apps.googleusercontent.com');
 assert.equal(error.code,'SHEETS_API_DISABLED');
 assert.equal(error.details.setupUrl,'https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=123456789');
 assert.match(error.message,/sign-in is still valid/);
});
test('permission errors are not misreported as disabled API',()=>{
 const error=sheetsRequestError(403,JSON.stringify({error:{message:'Forbidden'}}),'test.apps.googleusercontent.com');
 assert.equal(error.code,'SHEET_ACCESS'); assert.equal(error.details.setupUrl,undefined);
});
test('Google HTML and arbitrary server content never leak through the error banner',()=>{
 const error=sheetsRequestError(500,'<html>internal sensitive upstream data</html>','test');
 assert.equal(error.code,'GOOGLE_SHEETS'); assert.doesNotMatch(error.message,/sensitive/);
});
