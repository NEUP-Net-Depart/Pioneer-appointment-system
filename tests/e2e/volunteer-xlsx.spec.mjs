import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { volunteerWorkbook, volunteerZip } from '../../frontend/staff-react/report-xlsx.js';

const templateBytes = readFileSync(
  new URL('../../frontend/assets/volunteer-register-template.xlsx', import.meta.url)
);
const templateFiles = unzipSync(templateBytes);
const sheetPath = 'xl/worksheets/sheet1.xml';

// Use the browser's XML parser so these checks need no extra parser dependency.
async function verifyWorkbook(page, bytes, people) {
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual(Object.keys(templateFiles).sort());
  for (const path of Object.keys(templateFiles)) {
    if (path !== sheetPath && path !== 'xl/workbook.xml') {
      expect(files[path], `${path} is preserved`).toEqual(templateFiles[path]);
    }
  }
  const errors = await page.evaluate(
    ({ parts, templateXml, people }) => {
      const errors = [];
      const check = (valid, message) => {
        if (!valid) errors.push(message);
      };
      const parser = new DOMParser();
      const documents = {};
      for (const [path, source] of Object.entries(parts)) {
        const document = parser.parseFromString(source, 'application/xml');
        check(!document.querySelector('parsererror'), `${path} parses as XML`);
        documents[path] = document;
      }
      if (errors.length) return errors;
      const sheet = documents['xl/worksheets/sheet1.xml'];
      const source = parser.parseFromString(templateXml, 'application/xml');
      const sourceRows = new Map(
        [...source.querySelectorAll('sheetData > row')].map((row) => [
          Number(row.getAttribute('r')),
          row
        ])
      );
      const rows = [...sheet.querySelectorAll('sheetData > row')];
      const rowNumbers = rows.map((row) => Number(row.getAttribute('r')));
      const expectedNumbers = new Set(sourceRows.keys());
      people.forEach((_person, index) => expectedNumbers.add(index + 4));
      check(
        JSON.stringify(rowNumbers) === JSON.stringify([...expectedNumbers].sort((a, b) => a - b)),
        'rows are complete, unique and ordered by row number'
      );
      const byNumber = new Map(rows.map((row) => [Number(row.getAttribute('r')), row]));
      const styles = [...sourceRows.get(23).querySelectorAll('c')].map((cell) =>
        cell.getAttribute('s')
      );
      const strings = [...documents['xl/sharedStrings.xml'].querySelectorAll('sst > si')];
      for (const [index, person] of people.entries()) {
        const number = index + 4;
        const row = byNumber.get(number);
        if (!row) {
          check(false, `row ${number} exists`);
          continue;
        }
        check(row.getAttribute('hidden') !== '1', `row ${number} is visible`);
        check(
          row.getAttribute('ht') === sourceRows.get(23).getAttribute('ht'),
          `row ${number} height`
        );
        const cells = [...row.querySelectorAll('c')];
        check(cells.length === 9, `row ${number} has all nine cells`);
        const expected = [
          person.college,
          person.name,
          person.studentId,
          strings[14].textContent,
          String(person.hours),
          strings[15].textContent,
          strings[16].textContent,
          strings[17].textContent,
          '2026年5月25日-5月29日'
        ];
        cells.forEach((cell, column) => {
          const reference = `${String.fromCharCode(65 + column)}${number}`;
          check(cell.getAttribute('r') === reference, `${reference} reference`);
          check(cell.getAttribute('s') === styles[column], `${reference} style`);
          const kind = cell.getAttribute('t');
          const value =
            kind === 's'
              ? strings[Number(cell.querySelector('v').textContent)].textContent
              : cell.querySelector(kind === 'inlineStr' ? 'is' : 'v')?.textContent;
          check(value === expected[column], `${reference} value`);
          if (column === 2) check(kind === 'inlineStr', `${reference} keeps leading zeros`);
          if (column === 4) check(kind === null, `${reference} contains numeric hours`);
        });
      }
      for (const row of rows) {
        const number = Number(row.getAttribute('r'));
        if (number !== 1 && (number < 4 || number > people.length + 3)) {
          check(row.isEqualNode(sourceRows.get(number)), `unused row ${number} is preserved`);
        }
      }
      for (const tag of [
        'dimension',
        'cols',
        'mergeCells',
        'dataValidations',
        'pageMargins',
        'pageSetup'
      ]) {
        check(
          sheet.querySelector(tag).isEqualNode(source.querySelector(tag)),
          `${tag} is preserved`
        );
      }
      check(
        sheet.querySelector('c[r="A1"] t').textContent === '信息采集表（2026年5月）',
        'the month title is updated'
      );
      const printArea = documents['xl/workbook.xml'].querySelector(
        'definedName[name="_xlnm.Print_Area"]'
      );
      check(
        printArea.textContent === `Sheet1!$A$1:$O$${Math.max(23, people.length + 3)}`,
        'the print area covers every person'
      );
      return errors;
    },
    {
      parts: Object.fromEntries(
        Object.entries(files)
          .filter(([path]) => /\.(xml|rels)$/.test(path))
          .map(([path, bytes]) => [path, strFromU8(bytes)])
      ),
      templateXml: strFromU8(templateFiles[sheetPath]),
      people
    }
  );
  expect(errors).toEqual([]);
}

for (const count of [20, 21, 22, 23, 50, 601]) {
  test(`volunteer Excel and monthly ZIP preserve all ${count} people and valid worksheet XML`, async ({
    page
  }) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      college: '信息学院<&>',
      name: `测试人员${index + 1}"'`,
      studentId: `00${String(index + 1).padStart(6, '0')}`,
      hours: index % 2 ? 2.5 : 4
    }));
    const week = { weekStart: '2026-05-25', weekEnd: '2026-05-28', weekNumber: 4, rows };
    await verifyWorkbook(page, volunteerWorkbook('2026-05', week, templateBytes), rows);
    const archive = unzipSync(
      volunteerZip(
        {
          month: '2026-05',
          weeks: [
            {
              ...week,
              campuses: [
                { campus: '南湖', rows },
                { campus: '浑南', rows: [] }
              ]
            }
          ]
        },
        templateBytes
      )
    );
    expect(Object.keys(archive).sort()).toEqual(['南湖先锋5月4周.xlsx', '浑南先锋5月4周.xlsx']);
    await verifyWorkbook(page, archive['南湖先锋5月4周.xlsx'], rows);
    await verifyWorkbook(page, archive['浑南先锋5月4周.xlsx'], []);
  });
}

test('volunteer Excel inserts missing template rows in numeric order', async ({ page }) => {
  const files = { ...templateFiles };
  files[sheetPath] = strToU8(
    strFromU8(files[sheetPath]).replace(/<row r="(?:24|26|47)"[^>]*?(?:\/>|>[^]*?<\/row>)/g, '')
  );
  const rows = Array.from({ length: 50 }, () => ({
    college: '信息学院',
    name: '测试人员',
    studentId: '00123456',
    hours: 4
  }));
  await verifyWorkbook(
    page,
    volunteerWorkbook(
      '2026-05',
      {
        weekStart: '2026-05-25',
        weekEnd: '2026-05-28',
        rows
      },
      zipSync(files)
    ),
    rows
  );
});
