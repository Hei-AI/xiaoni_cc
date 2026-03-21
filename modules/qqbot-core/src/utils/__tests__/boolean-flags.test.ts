import { isAutoReplyAllowed, isDbBooleanEnabled } from '../boolean-flags';

describe('boolean flag helpers', () => {
  describe('isDbBooleanEnabled', () => {
    it('treats database truthy variants as enabled', () => {
      expect(isDbBooleanEnabled(true)).toBe(true);
      expect(isDbBooleanEnabled(1)).toBe(true);
      expect(isDbBooleanEnabled('1')).toBe(true);
    });

    it('treats database falsy variants as disabled', () => {
      expect(isDbBooleanEnabled(false)).toBe(false);
      expect(isDbBooleanEnabled(0)).toBe(false);
      expect(isDbBooleanEnabled('0')).toBe(false);
      expect(isDbBooleanEnabled(undefined)).toBe(false);
      expect(isDbBooleanEnabled(null)).toBe(false);
    });
  });

  describe('isAutoReplyAllowed', () => {
    it('allows auto reply when settings are missing', () => {
      expect(isAutoReplyAllowed(null)).toBe(true);
      expect(isAutoReplyAllowed(undefined)).toBe(true);
    });

    it('respects enabled and disabled database values', () => {
      expect(isAutoReplyAllowed({ auto_reply_enabled: 1 })).toBe(true);
      expect(isAutoReplyAllowed({ auto_reply_enabled: true })).toBe(true);
      expect(isAutoReplyAllowed({ auto_reply_enabled: 0 })).toBe(false);
      expect(isAutoReplyAllowed({ auto_reply_enabled: false })).toBe(false);
    });
  });
});
