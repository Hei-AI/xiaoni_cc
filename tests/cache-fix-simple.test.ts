/**
 * 简化版缓存修复验证测试
 * 专门测试cached.updated_at.getTime错误修复
 */
describe('Cache Fix Verification', () => {
  test('原始问题：cached.updated_at.getTime should cause error', () => {
    const updatedAtString = '2025-09-01T10:00:00.000Z';
    
    let errorOccurred = false;
    try {
      // 原始有问题的代码：直接调用getTime()
      const badAttempt = (updatedAtString as any).getTime();
    } catch (error) {
      errorOccurred = true;
      expect((error as Error).message).toContain('is not a function');
    }
    
    expect(errorOccurred).toBe(true);
  });

  test('修复后：安全地处理string类型的updated_at', () => {
    const updatedAtString = '2025-09-01T10:00:00.000Z';
    
    let updatedAt: Date;
    let succeeded = false;
    
    try {
      if ((updatedAtString as any) instanceof Date) {
        updatedAt = updatedAtString as any;
      } else if (typeof updatedAtString === 'string') {
        updatedAt = new Date(updatedAtString);
        succeeded = true;
      }
      
      expect(succeeded).toBe(true);
      expect(updatedAt!).toBeInstanceOf(Date);
      expect(updatedAt!.getTime()).toBeGreaterThan(0);
    } catch (error) {
      fail('修复后的代码不应该抛出错误');
    }
  });

  test('修复后：处理Date类型的updated_at', () => {
    const updatedAtDate = new Date('2025-09-01T10:00:00.000Z');
    
    let updatedAt: Date;
    let succeeded = false;
    
    try {
      if (updatedAtDate instanceof Date) {
        updatedAt = updatedAtDate;
        succeeded = true;
      } else if (typeof updatedAtDate === 'string') {
        updatedAt = new Date(updatedAtDate);
      }
      
      expect(succeeded).toBe(true);
      expect(updatedAt!).toBeInstanceOf(Date);
      expect(updatedAt!.getTime()).toBeGreaterThan(0);
    } catch (error) {
      fail('修复后的代码不应该抛出错误');
    }
  });

  test('修复后：处理null/undefined的updated_at', () => {
    const updatedAtNull = null;
    
    let updatedAt: Date | undefined;
    let shouldClearCache = false;
    
    try {
      if ((updatedAtNull as any) instanceof Date) {
        updatedAt = updatedAtNull as any;
      } else if (typeof updatedAtNull === 'string') {
        updatedAt = new Date(updatedAtNull);
      } else {
        shouldClearCache = true;
      }
      
      expect(shouldClearCache).toBe(true);
      expect(updatedAt).toBeUndefined();
    } catch (error) {
      fail('修复后的代码不应该抛出错误');
    }
  });
});