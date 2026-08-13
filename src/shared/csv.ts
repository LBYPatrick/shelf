/**
 * Reading delimited text.
 *
 * Written rather than pulled in because the requirement is narrow and the edge
 * cases are the whole job: a field containing the delimiter, a field containing
 * a newline, and an escaped quote inside a quoted field. A naive `split(',')`
 * gets all three wrong, and they are common enough in real exports that it
 * would fail on the first file anyone tried.
 */

export interface DelimitedTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Guesses the delimiter from the header line.
 *
 * Quoted spans are blanked out first. Counting them would let a single quoted
 * field full of commas outvote the real delimiter — `id;"a,b,c";x` is
 * semicolon-separated, but has more commas in it.
 */
export function detectDelimiter(text: string): string {
  const newline = text.indexOf('\n');
  const line = newline === -1 ? text : text.slice(0, newline);

  const unquoted = line.replace(/"(?:[^"]|"")*"/g, '""');
  const candidates = [',', '\t', ';', '|'];

  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = unquoted.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      fields.push(field);
      field = '';
    } else field += char;
  }

  fields.push(field);
  return fields;
}

export function parseDelimited(text: string, delimiter?: string): DelimitedTable {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const separator = delimiter ?? detectDelimiter(clean);

  const lines: string[] = [];
  let current = '';
  let quoted = false;

  // Split on newlines that are not inside a quoted field.
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (char === '"') {
      if (quoted && clean[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      quoted = !quoted;
      current += char;
      continue;
    }

    if (char === '\n' && !quoted) {
      lines.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) lines.push(current);

  const parsed = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => parseLine(line, separator));
  const [header, ...rows] = parsed;

  return { header: header ?? [], rows };
}

/** Reads a JSON array of objects into the same shape. */
export function parseJsonRows(text: string): DelimitedTable {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];

  const header: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!header.includes(key)) header.push(key);
    }
  }

  const rows = list.map((item) =>
    header.map((key) => {
      const value = (item as Record<string, unknown>)[key];
      if (value === null || value === undefined) return '';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    })
  );

  return { header, rows };
}
