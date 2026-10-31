import { readFile, writeFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error('Usage: node scripts/prepare-volunteer-template.mjs <sample.xlsx> <output.xlsx>');
}

const files = unzipSync(await readFile(source));
const sheetPath = 'xl/worksheets/sheet1.xml';
let sheet = strFromU8(files[sheetPath]);
let strings = strFromU8(files['xl/sharedStrings.xml']);
const sharedEntries = strings.match(/<si>[^]*?<\/si>/g);
if (sharedEntries?.length !== 43 || !sheet.includes('<row r="23"')) {
  throw new Error('Volunteer sample layout changed; review the template before preparing it.');
}

let index = 0;
strings = strings.replace(/<si>[^]*?<\/si>/g, (entry) => {
  const keep = index < 12 || [14, 15, 16, 17].includes(index);
  index += 1;
  return keep ? entry : '<si><t></t></si>';
});

for (let number = 4; number <= 23; number += 1) {
  const rowPattern = new RegExp(`<row r="${number}"[^>]*>[^]*?<\\/row>`);
  const row = sheet.match(rowPattern)?.[0];
  if (!row) throw new Error(`Missing sample row ${number}`);
  const empty = row.replace(
    /<c r="([A-I])(\d+)"([^>]*?)(?:\/>|>[^]*?<\/c>)/g,
    (_cell, col, rowNumber, attrs) => {
      const style = attrs.match(/\bs="(\d+)"/)?.[1];
      if (!style) throw new Error(`Missing style for ${col}${rowNumber}`);
      return `<c r="${col}${rowNumber}" s="${style}"/>`;
    }
  );
  sheet = sheet.replace(row, empty);
}

const corePath = 'docProps/core.xml';
const core = strFromU8(files[corePath])
  .replace(/<dc:creator>[^]*?<\/dc:creator>/, '<dc:creator>Pioneer</dc:creator>')
  .replace(
    /<cp:lastModifiedBy>[^]*?<\/cp:lastModifiedBy>/,
    '<cp:lastModifiedBy>Pioneer</cp:lastModifiedBy>'
  );
files[corePath] = strToU8(core);
files[sheetPath] = strToU8(sheet);
files['xl/sharedStrings.xml'] = strToU8(strings);
await writeFile(destination, zipSync(files, { level: 6 }));
