import { describe, expect, it } from 'vitest';
import { applySuggestion } from '../src/core';

describe('applySuggestion', () => {
  const file = 'a\nb\nc\nd\n';

  it('замінює один рядок', () => {
    expect(applySuggestion(file, 2, 2, 'B')).toBe('a\nB\nc\nd\n');
  });

  it('замінює діапазон кількома рядками', () => {
    expect(applySuggestion(file, 2, 3, 'x\ny\nz')).toBe('a\nx\ny\nz\nd\n');
  });

  it('порожній suggestion видаляє рядки', () => {
    expect(applySuggestion(file, 2, 3, '')).toBe('a\nd\n');
  });

  it('зберігає \\r\\n у файлі', () => {
    expect(applySuggestion('a\r\nb\r\n', 1, 1, 'A\nA2')).toBe('A\r\nA2\r\nb\r\n');
  });

  it('зберігає відсутність фінального переносу', () => {
    expect(applySuggestion('a\nb', 2, 2, 'B')).toBe('a\nB');
  });

  it('замінює останній рядок', () => {
    expect(applySuggestion(file, 4, 4, 'D')).toBe('a\nb\nc\nD\n');
  });

  it('кидає помилку, якщо рядки за межами файлу', () => {
    expect(() => applySuggestion(file, 4, 5, 'x')).toThrow('виходять за межі файлу (4 рядків)');
  });

  it('кидає помилку для некоректного діапазону', () => {
    expect(() => applySuggestion(file, 3, 2, 'x')).toThrow('некоректний діапазон');
    expect(() => applySuggestion(file, 0, 1, 'x')).toThrow('некоректний діапазон');
  });
});
