export type JsonSchemaValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateJsonSchemaValue(
  value: unknown,
  schema: any,
  path: string = '$'
): JsonSchemaValidationResult {
  const errors: string[] = [];
  validateNode(value, schema, path, errors);
  return {
    valid: errors.length === 0,
    errors
  };
}

function validateNode(
  value: unknown,
  schema: any,
  path: string,
  errors: string[]
): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0 && !schema.enum.includes(value)) {
    errors.push(`${path}: value must be one of ${schema.enum.join(', ')}`);
    return;
  }

  const expectedType = schema.type;
  if (expectedType === 'object') {
    if (!isPlainObject(value)) {
      errors.push(`${path}: expected object`);
      return;
    }

    const objectValue = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    required.forEach((key: string) => {
      if (!Object.prototype.hasOwnProperty.call(objectValue, key)) {
        errors.push(`${path}.${key}: required property is missing`);
      }
    });

    const properties = isPlainObject(schema.properties)
      ? schema.properties as Record<string, any>
      : {};
    Object.entries(properties).forEach(([key, propertySchema]) => {
      if (!Object.prototype.hasOwnProperty.call(objectValue, key)) {
        return;
      }
      validateNode(objectValue[key], propertySchema, `${path}.${key}`, errors);
    });
    return;
  }

  if (expectedType === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }

    if (schema.items) {
      value.forEach((item, index) => {
        validateNode(item, schema.items, `${path}[${index}]`, errors);
      });
    }
    return;
  }

  if (expectedType === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path}: expected string`);
    }
    return;
  }

  if (expectedType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path}: expected number`);
    }
    return;
  }

  if (expectedType === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${path}: expected boolean`);
    }
    return;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
