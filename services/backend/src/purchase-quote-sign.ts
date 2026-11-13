import { createPrivateKey,sign } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync,lstatSync } from 'node:fs';
import { canonicalJson } from '@shucamoxa/shared';
import { SignedPurchaseQuote } from './purchase-quotes';
// Owner's quote-publisher process only. The payment host receives the PUBLIC key only.
try {
 const [claimsFile,keyFile,outputFile]=process.argv.slice(2);
 if(!claimsFile||!keyFile||!outputFile||process.argv.length!==5)throw new Error('usage');
 const stat=lstatSync(keyFile);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('private key permissions');
 const claims=SignedPurchaseQuote.parse(JSON.parse(readFileSync(claimsFile,'utf8')));
 const key=createPrivateKey(readFileSync(keyFile));if(key.asymmetricKeyType!=='ed25519')throw new Error('key type');
 const packet={claims,signature:sign(null,Buffer.from(canonicalJson(claims)),key).toString('base64url')};
 const temp=outputFile+'.new';writeFileSync(temp,canonicalJson(packet),{mode:0o600,flag:'wx'});renameSync(temp,outputFile);
 console.log('Published signed rate and fee ceiling. No wallet key loaded.');
}catch{console.error('Quote publication refused. Check claims, private-key permissions and output path.');process.exitCode=1;}
