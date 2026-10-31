/**
 * Template Interpolator
 * Substitutes dynamic placeholders in SMS copy using standard mustache {{var}}
 * or natural Ethiopic bracket placeholders [የተማሪ ስም].
 */

export interface TemplateVariables {
  studentName?: string;
  amount?: string | number;
  dueDate?: string;
  courseName?: string;
  batchCode?: string;
  academyName?: string;
  academyPhone?: string;
  [key: string]: any;
}

export function interpolateTemplate(template: string, vars: TemplateVariables): string {
  if (!template) return '';

  let output = template;

  const replacements: Record<string, string | undefined> = {
    // English mustache style
    '{{student_name}}': vars.studentName,
    '{student_name}': vars.studentName,
    '{{amount}}': vars.amount !== undefined ? String(vars.amount) : undefined,
    '{amount}': vars.amount !== undefined ? String(vars.amount) : undefined,
    '{{due_date}}': vars.dueDate,
    '{due_date}': vars.dueDate,
    '{{course_name}}': vars.courseName,
    '{course_name}': vars.courseName,
    '{{batch_code}}': vars.batchCode,
    '{batch_code}': vars.batchCode,
    '{{academy_name}}': vars.academyName,
    '{academy_name}': vars.academyName,
    '{{academy_phone}}': vars.academyPhone,
    '{academy_phone}': vars.academyPhone,

    // Amharic bracket style from Stitch
    '[የተማሪ ስም]': vars.studentName,
    '[የተማሪ_ስም]': vars.studentName,
    '[መጠን]': vars.amount !== undefined ? String(vars.amount) : undefined,
    '[ቀን]': vars.dueDate,
    '[የትምህርት አይነት]': vars.courseName,
    '[የክፍል ኮድ]': vars.batchCode,
    '[የአካዳሚ ስም]': vars.academyName,
  };

  for (const [placeholder, val] of Object.entries(replacements)) {
    if (val !== undefined && val !== null) {
      output = output.split(placeholder).join(val);
    }
  }

  return output;
}
