/* GradeDock SF1 importer: DepEd School Form 1 and regular Excel lists.
   SheetJS reads legacy .xls and .xlsx; this module only interprets learner rows.
   Uses the LRN / NAME / SEX columns and TOTAL MALE / TOTAL FEMALE sections.
   No student data is uploaded until the teacher confirms the preview. */
window.GradeDockRosterImport = (() => {
  'use strict';
  const cell = value => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return cell(value.text ?? value.result ?? '');
    return String(value).replace(/\s+/g, ' ').trim();
  };
  const nameKey = value => cell(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const gender = value => {
    const s=cell(value).replace(/\.$/,'').toLowerCase();
    return ['m','male','males','boy','boys'].includes(s) ? 'Male'
      : ['f','female','females','girl','girls'].includes(s) ? 'Female' : '';
  };
  const learnerName = value => {
    const s=cell(value);
    return s.length>=3 && /[a-zÀ-ÿÑñ]/i.test(s)
      && !/^(?:total|name|school|teacher|lrn|student|learner|sex|gender|birth|age|address|guardian|mother|father|remarks|prepared|certified|combined)\b/i.test(s);
  };
  const lrn = value => {
    const s=cell(value).replace(/(?:\.0+)$/, '').replace(/[\s-]/g,'');
    return /^\d{12}$/.test(s) ? s : '';
  };
  function findHeader(rows) {
    for(let r=0;r<Math.min(100,rows.length);r++){
      const cells=(rows[r]||[]).map(v=>cell(v).toLowerCase());
      const lrnCol=cells.findIndex(s=>/^lrn\b/.test(s)||/^learner reference number\b/.test(s));
      const nameCol=cells.findIndex(s=>/^name\b/.test(s)||/^(?:learner|student)\s*(?:'s\s*)?name\b/.test(s)||/^full\s*name\b/.test(s));
      const sexCol=cells.findIndex(s=>/^sex\b/.test(s)||/^gender\b/.test(s));
      if (lrnCol>=0 && nameCol>=0) return {row:r,lrnCol,nameCol,sexCol};
    }
    return null;
  }
  function parseSF1(rows, sheetName) {
    const hdr=findHeader(rows);
    const top=rows.slice(0,100).flat().map(cell).join(' ').toUpperCase();
    const isSf1=!!hdr && (/SCHOOL\s+FORM\s*1|SCHOOL REGISTER|\bTOTAL\s+MALE\b/i.test(top)
      || (/\bLRN\b/.test(top) && /\bSEX\s*\(?M\s*\/\s*F\)?/.test(top)));
    if(!isSf1) return null;
    const result=[];
    const separated=rows.some(r=>(r||[]).some(v=>/\bTOTAL\s+MALES?\b/i.test(cell(v))));
    let section=gender(sheetName)||(separated?'Male':'Unspecified');
    let skipped=0;
    for(let i=hdr.row+1;i<rows.length;i++){
      const values=(rows[i]||[]).map(cell);
      const line=values.join(' ').toUpperCase();
      if(/\bTOTAL\s+MALES?\b/.test(line)){section='Female';continue;}
      if(/\bTOTAL\s+FEMALES?\b|\bCOMBINED\b/.test(line))break;
      const loneLabel=values.filter(Boolean);
      if(loneLabel.length===1 && gender(loneLabel[0])) {section=gender(loneLabel[0]);continue;}
      const lrnCol=lrn(values[hdr.lrnCol])?hdr.lrnCol:values.findIndex(v=>!!lrn(v));
      if(lrnCol<0)continue;
      let full=cell(values[hdr.nameCol]);
      if(!learnerName(full)){
        full='';
        for(let c=lrnCol+1;c<Math.min(values.length,lrnCol+7);c++){
          if(learnerName(values[c])){full=values[c];break;}
        }
      }
      if(!learnerName(full)){skipped++;continue;}
      const sex = hdr.sexCol>=0?gender(values[hdr.sexCol]):'';
      const sexFromRow = values.map(gender).find(Boolean);
      const resolved = sex || sexFromRow || section || 'Unspecified';
      result.push({full_name:full,gender:resolved,lrn:lrn(values[lrnCol])});
    }
    return {students:result,format:'DepEd School Form 1 (SF1)',skipped};
  }
  function parseList(rows,sheetName) {
    const result=[];let skipped=0;
    let activeGender=gender(sheetName)||'';
    let h=null;
    for(const original of rows){
      const values=(original||[]).map(cell);
      const nonempty=values.filter(Boolean);
      if(!nonempty.length)continue;
      const line=nonempty.join(' ');
      if(/\bTOTAL\s+MALES?\b/i.test(line)){activeGender='Female';continue;}
      if(/\bTOTAL\s+FEMALES?\b|\bCOMBINED\b/i.test(line)){activeGender='';continue;}
      if(nonempty.length<=2 && gender(nonempty[0])){activeGender=gender(nonempty[0]);continue;}
      const keys=values.map(s=>s.toLowerCase().replace(/[^a-z0-9]/g,''));
      const find=re=>keys.findIndex(v=>re.test(v));
      const full=find(/^(?:name|fullname|studentname|learnername|nameoflearner|nameofstudent)$/);
      const first=find(/^(?:firstname|givenname)$/);
      const last=find(/^(?:lastname|surname|familyname)$/);
      const middle=find(/^(?:middlename|middleinitial)$/);
      const sex=find(/^(?:sex|gender)$/);
      const id=find(/^(?:lrn|learnerreferencenumber)$/);
      if(full>=0||(first>=0&&last>=0)){h={full,first,last,middle,sex,id};continue;}
      if(/school form|school year|grade level|school name|adviser|prepared by|certified|\btotal\b|date of birth/i.test(line))continue;
      let fullName='';
      if(h?.full>=0)fullName=values[h.full];
      else if(h?.last>=0&&h?.first>=0)fullName=[values[h.last],[values[h.first],h.middle>=0?values[h.middle]:''].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      else if(nonempty.length<=4){fullName=values.find(v=>learnerName(v) && !/^\d{12}$/.test(v))||'';}
      if(!learnerName(fullName)){skipped++;continue;}
      const detectedSex=h?.sex>=0?gender(values[h.sex]):'';
      const detectedLRN=h?.id>=0?lrn(values[h.id]):values.map(lrn).find(Boolean)||'';
      result.push({full_name:fullName,gender:detectedSex||activeGender||'Unspecified',lrn:detectedLRN});
    }
    return {students:result,format:'Excel student list',skipped};
  }
  function csvRows(data) {
    const rows=[];let row=[],val='',quoted=false;
    data=data.replace(/^\ufeff/,'');
    for(let i=0;i<data.length;i++){
      const c=data[i];
      if(c==='"'){if(quoted&&data[i+1]==='"'){val+='"';i++;}else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(val);val='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&data[i+1]==='\n')i++;row.push(val);rows.push(row);row=[];val='';}
      else val+=c;
    }
    if(val||row.length){row.push(val);rows.push(row);}
    return rows;
  }
  async function read(file,existing=[]){
    if(!file)throw new Error('Choose your SF1 Excel file first.');
    let sheets;
    if(/\.csv$/i.test(file.name))sheets=[{name:'Roster',rows:csvRows(await file.text())}];
    else if(/\.(?:xls|xlsx)$/i.test(file.name)){
      if(!window.XLSX)throw new Error('The Excel reader has not loaded. Connect to the internet, refresh GradeDock, and try again.');
      let wb;
      try {wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});}
      catch(err){throw new Error('This Excel file could not be opened. '+(err.message||''));}
      sheets=(wb.SheetNames||[]).map(name=>({name,rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:'',blankrows:false})}));
    } else throw new Error('Please upload a .xls, .xlsx, or .csv file.');
    if(!sheets.length)throw new Error('The workbook contains no readable sheets.');
    // Official SF1: prefer the one sheet with the most legitimate LRN rows.
    let found=sheets.map(sheet=>parseSF1(sheet.rows,sheet.name)).filter(Boolean)
      .sort((a,b)=>b.students.length-a.students.length)[0];
    if(!found){
      const all=sheets.map(sheet=>parseList(sheet.rows,sheet.name));
      found={students:all.flatMap(x=>x.students),skipped:all.reduce((n,x)=>n+x.skipped,0),format:'Excel student list'};
    }
    const seenNames=new Set(existing.map(x=>nameKey(x.full_name||x)));
    const seenLrns=new Set(existing.map(x=>lrn(x.lrn)).filter(Boolean));
    const sorted=[];let duplicates=0;
    for(const record of found.students){
      const name=nameKey(record.full_name), id=lrn(record.lrn);
      if(!name||(seenNames.has(name))||(id&&seenLrns.has(id))){duplicates++;continue;}
      seenNames.add(name);if(id)seenLrns.add(id);
      sorted.push({...record,lrn:id,gender:record.gender||'Unspecified'});
    }
    const rank={Male:0,Female:1,Unspecified:2};
    sorted.sort((a,b)=>(rank[a.gender]??2)-(rank[b.gender]??2));
    return {students:sorted, format:found.format, duplicates, skipped:found.skipped};
  }
  return {read};
})();
