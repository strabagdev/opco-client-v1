type Diagnostic={code:"NORMAL_DOWNLOAD"|"ATTENDANCE_REUSED"|"REUSE_WITHDRAWN";reuse:boolean;skipDownloads:boolean};
const history:Diagnostic[]=[];
export function recordSelectiveReuseDiagnostic(code:Diagnostic["code"],reused=false){
 history.push({code,reuse:reused,skipDownloads:reused});if(history.length>50)history.shift();
}
export function getSelectiveReuseDiagnostics(){return history.map(row=>({...row}));}
