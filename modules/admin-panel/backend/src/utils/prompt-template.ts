export function renderPromptTemplate(
  template: string,
  contextVariables: Record<string, unknown> = {},
  runtimeVariables: Record<string, unknown> = {}
): string {
  if (!template || typeof template !== 'string') {
    return template || '';
  }

  const allVariables: Record<string, unknown> = {
    ...contextVariables,
    ...runtimeVariables
  };

  let rendered = template;

  rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, variableName) => {
    if (!Object.prototype.hasOwnProperty.call(allVariables, variableName)) {
      return match;
    }
    return stringifyTemplateValue(allVariables[variableName]);
  });

  rendered = rendered.replace(/\$\{(\w+)\}/g, (match, variableName) => {
    if (!Object.prototype.hasOwnProperty.call(allVariables, variableName)) {
      return match;
    }
    return stringifyTemplateValue(allVariables[variableName]);
  });

  rendered = rendered.replace(/\{\{now\.(\w+)\}\}/g, (_match, format) => {
    const now = new Date();
    switch (format) {
      case 'iso':
        return now.toISOString();
      case 'date':
        return now.toDateString();
      case 'time':
        return now.toTimeString();
      case 'locale':
        return now.toLocaleString('zh-CN');
      default:
        return now.toISOString();
    }
  });

  return rendered;
}

function stringifyTemplateValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const serialized = JSON.stringify(value);
  if (typeof serialized === 'string') {
    return serialized;
  }

  return String(value);
}
