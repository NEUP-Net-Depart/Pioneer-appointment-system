import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const escapeXml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]
  );

function column(number) {
  let result = '';
  for (let value = number; value; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function cell(row, index, value, style = 0) {
  const ref = `${column(index)}${row}`;
  if (typeof value === 'number' && Number.isFinite(value))
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="3"><font><sz val="11"/><name val="宋体"/></font><font><b/><sz val="20"/><name val="宋体"/></font><font><b/><sz val="11"/><name val="宋体"/></font></fonts>
 <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
 <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function workbook(sheetRows, widths, merges, printEnd) {
  const rowsXml = sheetRows
    .map((values, rowIndex) => {
      const number = rowIndex + 1;
      const height = number === 1 ? 34.8 : number === 2 ? 18.6 : 17.4;
      const cells = values.map((entry, index) =>
        cell(
          number,
          index + 1,
          entry.value,
          entry.style ?? (number === 1 ? 1 : number === 2 ? 2 : number === 3 ? 3 : 4)
        )
      );
      return `<row r="${number}" ht="${height}" customHeight="1">${cells.join('')}</row>`;
    })
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="17.4"/><cols>${widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )
    .join('')}</cols>
<sheetData>${rowsXml}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$${column(printEnd)}$${sheetRows.length}</definedName></definedNames></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8(styles)
  };
  return zipSync(files, { level: 6 });
}

const text = (value, style) => ({ value, style });

function replaceTemplateCell(row, reference, value, kind = 'text') {
  const pattern = new RegExp(`<c r="${reference}"([^>]*?)(?:\\/>|>[^]*?<\\/c>)`);
  let found = false;
  const result = row.replace(pattern, (_original, attributes) => {
    found = true;
    const style = attributes.match(/\bs="(\d+)"/)?.[1];
    if (!style) throw new Error(`志愿登记表模板缺少 ${reference} 的样式`);
    const content =
      kind === 'number' || kind === 'shared'
        ? `<v>${value}</v>`
        : `<is><t>${escapeXml(value)}</t></is>`;
    const type = kind === 'text' ? ' t="inlineStr"' : kind === 'shared' ? ' t="s"' : '';
    return `<c r="${reference}" s="${style}"${type}>${content}</c>`;
  });
  if (!found) throw new Error(`志愿登记表模板缺少 ${reference}`);
  return result;
}

export function volunteerWorkbook(month, week, templateBytes) {
  if (!templateBytes) throw new Error('志愿登记表模板未加载');
  const [year, monthNumber] = month.split('-').map(Number);
  const dayText = (date) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  const duration = `${year}年${dayText(week.weekStart)}-${dayText(week.weekEnd)}`;
  if (week.rows.length > 601) throw new Error('单周人员超过模板可容纳的 601 行');
  const files = unzipSync(templateBytes);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let sheet = strFromU8(files[sheetPath]);
  sheet = replaceTemplateCell(sheet, 'A1', `信息采集表（${year}年${monthNumber}月）`);
  const rows = new Map(
    [...sheet.matchAll(/<row r="(\d+)"[^>]*?(?:\/>|>[^]*?<\/row>)/g)].map(([row, number]) => [
      Number(number),
      row
    ])
  );
  const templateRow = rows.get(23);
  if (!templateRow) throw new Error('志愿登记表模板行结构无效');

  for (let index = 0; index < week.rows.length; index += 1) {
    const number = index + 4;
    let row =
      number <= 23
        ? rows.get(number)
        : templateRow
            .replace('<row r="23"', `<row r="${number}"`)
            .replace(/r="([A-I])23"/g, (_ref, col) => `r="${col}${number}"`);
    if (!row) throw new Error(`志愿登记表模板缺少第 ${number} 行`);
    const person = week.rows[index];
    const values = [
      ['A', person.college],
      ['B', person.name],
      ['C', person.studentId],
      ['D', 14, 'shared'],
      ['E', person.hours, 'number'],
      ['F', 15, 'shared'],
      ['G', 16, 'shared'],
      ['H', 17, 'shared'],
      ['I', duration]
    ];
    for (const [col, value, kind] of values) {
      row = replaceTemplateCell(row, `${col}${number}`, value, kind);
    }
    rows.set(number, row);
  }
  sheet = sheet.replace(
    /<sheetData>[^]*?<\/sheetData>/,
    `<sheetData>${[...rows]
      .sort(([a], [b]) => a - b)
      .map(([, row]) => row)
      .join('')}</sheetData>`
  );
  files[sheetPath] = strToU8(sheet);
  if (week.rows.length > 20) {
    const workbookPath = 'xl/workbook.xml';
    const source = strFromU8(files[workbookPath]);
    const updated = source.replace('Sheet1!$A$1:$O$23', `Sheet1!$A$1:$O$${week.rows.length + 3}`);
    if (updated === source) throw new Error('志愿登记表模板缺少打印范围');
    files[workbookPath] = strToU8(updated);
  }
  return zipSync(files, { level: 6 });
}

export function attendanceMatrixWorkbook(report) {
  const dates = report.dates;
  const end = dates.length + 3;
  const rows = [
    [text(`${report.month} 考勤记录`, 1)],
    [text('实际维修日签到：同人同日只计一次', 2)],
    [
      '姓名',
      '学号',
      ...dates.map((day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`),
      '合计'
    ].map((value) => text(value, 3))
  ];
  const merges = [`A1:${column(end)}1`, `A2:${column(end)}2`];
  let group = '';
  for (const person of report.rows) {
    const nextGroup = `${person.campus} · ${person.department}`;
    if (nextGroup !== group) {
      group = nextGroup;
      const row = rows.length + 1;
      rows.push([text(group, 2)]);
      merges.push(`A${row}:${column(end)}${row}`);
    }
    const days = new Set(person.days);
    rows.push(
      [
        person.name,
        person.studentId,
        ...dates.map((date) => (days.has(date) ? 1 : '')),
        days.size
      ].map((value) => text(value, 4))
    );
  }
  return workbook(rows, [15, 16, ...dates.map(() => 11), 12], merges, end);
}

export function volunteerZip(report, templateBytes) {
  const month = Number(report.month.slice(5));
  const files = {};
  for (const week of report.weeks)
    for (const campus of week.campuses) {
      const filename = `${campus.campus}先锋${month}月${week.weekNumber}周.xlsx`;
      files[filename] = volunteerWorkbook(
        report.month,
        { ...week, rows: campus.rows },
        templateBytes
      );
    }
  return zipSync(files, { level: 6 });
}
