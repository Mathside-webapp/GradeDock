/* Flexible SF1 and ordinary school roster importer; no scanning code changes. */
window.GradeDockRosterImport = (() => {
  const str = v => {
    if (v == null) return '';
    if (typeof v === 'object') return str(v.text ?? v.result ?? v.richText?.map(t=>t.text).join('') ?? '');
    return String(v).trim();
  };
  const clean = s => str(s).replace(/\s+/g,' ').trim();
  const key = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const asGender = s => /^(male|males|boy|boys|m)$/i.test(clean(s))?'Male':/^(female|females|girl|girls|f)$/i.test(clean(s))?'Female':'';
  const isHeader = s => /learner|student|last.?name|surname|first.?name|given.?name|middle.?name|\blrn\b|sex|gender|school form|grade|section|remarks|total|no\.|number/i.test(s);
  function parseGrid(rows, sheetName, existing, fallbackGender) {
    const seen = existing; const imported=[]; let gender=asGender(sheetName)||'';
    let cols=null;let skipped=0;
    for (const r of rows) {
      const values = r.map(clean); const nonEmpty=values.filter(Boolean);
      if (!nonEmpty.length) continue;
      const heading=nonEmpty.join(' ').trim();
      const section = asGender(heading.replace(/[:\-]/g,''));
      if(section){gender=section;continue;}
      const labels=values.map(key);
      const find = re => labels.findIndex(x=>re.test(x));
      const first=find(/^(firstname|givenname|given)$/),last=find(/^(lastname|surname|familyname)$/),middle=find(/^(middlename|middleinitial|middle)$/);
      const name=find(/^(learners?name|nameoflearner|studentname|nameofstudent|fullname|name)$/);
      const lrn=find(/^(lrn|learnerreferencenumber)$/), sex=find(/^(sex|gender)$/);
      if (first>=0 || last>=0 || name>=0){cols={first,last,middle,name,lrn,sex};continue;}
      if (/^(male|female|males|females|boys|girls)\b/i.test(heading) && nonEmpty.length<=3){ gender=asGender(nonEmpty[0]);continue; }
      if (/school form|school year|grade level|adviser|prepared by|certified|total|page \d+/i.test(heading)) continue;
      const lrnIdx=values.findIndex(x=>/^\d{12}$/.test(x.replace(/[\s-]/g,'')));
      const lrnVal=cols?.lrn>=0 ? values[cols.lrn] : (lrnIdx>=0?values[lrnIdx]:'');
      const lrnValue=/^\d{12}$/.test(lrnVal.replace(/[\s-]/g,'')) ? lrnVal.replace(/[\s-]/g,'') : '';
      let full='';
      if(cols?.first>=0 && cols?.last>=0){const l=values[cols.last],f=values[cols.first],m=cols.middle>=0?values[cols.middle]:'';full=[l,[f,m].filter(Boolean).join(' ')].filter(Boolean).join(', ');}
      else if(cols?.name>=0) full=values[cols.name];
      else {
        const options=values.map((v,i)=>({v,i})).filter(({v,i})=>v && i!==lrnIdx && !/^\d+$/.test(v) && !asGender(v) && !isHeader(v) && /[a-zÀ-ÿ]/i.test(v));
        full=(options.find(({v})=>v.includes(',') || v.split(' ').length>=2) || options.find(({v})=>v.length>=5))?.v||'';
      }
      full=clean(full).replace(/^\d+[.)\-]?\s+/,'');
      if(!full||full.length<4||isHeader(full)||!/[a-zÀ-ÿ]{2,}/i.test(full)){skipped++;continue;}
      const rowGender=cols?.sex>=0?asGender(values[cols.sex]):values.map(asGender).find(Boolean);
      const resolved=rowGender || gender || fallbackGender;
      const identity=key(full);
      if(seen.has(identity)){skipped++;continue;}
      seen.add(identity);
      imported.push({full_name:full,gender:resolved||'',lrn:lrnValue});
    }
    return {imported,skipped};
  }
  function csvRows(text) {
    const rows=[];let row=[],val='',quoted=false;
    text=text.replace(/^\ufeff/,'');
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){val+='"';i++;}else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(val);val='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(val);rows.push(row);row=[];val='';}
      else val+=c;
    }
    if(val||row.length){row.push(val);rows.push(row);}
    return rows;
  }
  async function read(file,existing=[],fallbackGender=''){
    const seen=new Set(existing.map(s=>key(s.full_name||s)));
    let sets=[];
    if(/\.csv$/i.test(file.name)) sets=[{name:'Roster',rows:csvRows(await file.text())}];
    else if(/\.xlsx$/i.test(file.name)){
      if(!window.ExcelJS) throw new Error('Excel reader did not load. Please check your internet connection.');
      const wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());
      sets=wb.worksheets.map(w=>{const rows=[];w.eachRow({includeEmpty:false},row=>{const values=[];for(let c=1;c<=Math.min(row.cellCount,40);c++)values.push(str(row.getCell(c).value));rows.push(values);});return {name:w.name,rows};});
    } else throw new Error('Unsupported format. Please choose an .xlsx or .csv file. For old .xls files, use Excel Save As → .xlsx.');
    let result=[];let skipped=0;
    for(const sheet of sets){const out=parseGrid(sheet.rows,sheet.name,seen,fallbackGender);result.push(...out.imported);skipped+=out.skipped;}
    return {students:result,skipped};
  }
  return {read};
})();
