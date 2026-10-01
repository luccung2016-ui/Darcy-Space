const SPREADSHEET_ID = '1x0rq80tmbYblUxbI1YUaeBXU9zQdibHEhdJemckSieo';
const ALLOWED_SHEETS = ['ROUTINES','TASKS','PROJECTS','CONTENT','REVISIONS','PERFORMANCE_FB','PERFORMANCE_TIKTOK'];

function doGet(e) {
  try {
    auth_(e && e.parameter ? e.parameter.token : '');
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const out = {};
    ALLOWED_SHEETS.forEach(name => {
      const sh = ss.getSheetByName(name);
      out[name] = sh ? sheetObjects_(sh) : [];
    });
    return json_({ok:true, spreadsheetId:SPREADSHEET_ID, syncedAt:new Date().toISOString(), data:out});
  } catch (err) {
    return json_({ok:false,error:String(err && err.message ? err.message : err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    auth_(body.token || '');
    const sheetName = String(body.sheet || '').trim();
    if (!ALLOWED_SHEETS.includes(sheetName)) throw new Error('SHEET_NOT_ALLOWED');
    const action = String(body.action || 'upsert');
    const record = body.record || {};
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(sheetName);
    if (!sh) throw new Error('SHEET_NOT_FOUND');
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0].map(String);

    if (action === 'append') {
      const row = headers.map(h => record[h] == null ? '' : record[h]);
      sh.appendRow(row);
      return json_({ok:true,action:'append',row:sh.getLastRow()});
    }

    if (action === 'update' || action === 'upsert') {
      const keyField = String(body.keyField || headers[0] || '').trim();
      const keyValue = String(body.keyValue != null ? body.keyValue : record[keyField] || '').trim();
      if (!keyField || !keyValue) throw new Error('MISSING_KEY');
      const keyCol = headers.indexOf(keyField) + 1;
      if (keyCol < 1) throw new Error('KEY_FIELD_NOT_FOUND');
      const last = sh.getLastRow();
      let target = 0;
      if (last >= 2) {
        const vals = sh.getRange(2,keyCol,last-1,1).getDisplayValues();
        for (let i=0;i<vals.length;i++) if (String(vals[i][0]).trim() === keyValue) { target = i+2; break; }
      }
      if (!target) {
        if (action === 'update') throw new Error('RECORD_NOT_FOUND');
        const row = headers.map(h => record[h] == null ? '' : record[h]);
        sh.appendRow(row);
        target = sh.getLastRow();
      } else {
        const current = sh.getRange(target,1,1,headers.length).getValues()[0];
        headers.forEach((h,i) => { if (Object.prototype.hasOwnProperty.call(record,h)) current[i] = record[h]; });
        sh.getRange(target,1,1,headers.length).setValues([current]);
      }
      return json_({ok:true,action:target===sh.getLastRow()?'upsert':'update',row:target});
    }

    throw new Error('ACTION_NOT_SUPPORTED');
  } catch (err) {
    return json_({ok:false,error:String(err && err.message ? err.message : err)});
  }
}

function auth_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('DASHBOARD_TOKEN');
  if (!expected || token !== expected) throw new Error('UNAUTHORIZED');
}

function sheetObjects_(sh) {
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  const values = sh.getRange(1,1,lastRow,lastCol).getDisplayValues();
  const headers = values[0].map(x => String(x || '').trim());
  return values.slice(1).filter(r => r.some(v => String(v || '').trim() !== '')).map((r,i) => {
    const o = {_row:i+2}; headers.forEach((h,j) => o[h] = r[j] || ''); return o;
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
