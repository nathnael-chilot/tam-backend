/**
 * SMS Segment Calculator
 * Accurately determines encoding (GSM-7 vs UCS-2 / Unicode) and calculates billable segments.
 *
 * Telecom Rules (Ethio Telecom, Safaricom, AfroMessage):
 * - GSM-7: 160 chars for single segment; 153 chars/segment for multi-part (7 chars for UDH).
 * - UCS-2 (Amharic / Ge'ez / Emojis): 70 chars for single segment; 67 chars/segment for multi-part (3 chars for UDH).
 */

// GSM 7-bit basic character set regex (excluding extended characters for strict checking)
const GSM_7_REGEX = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !\"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

export interface SegmentCalculation {
  isUnicode: boolean;
  charCount: number;
  segments: number;
  maxCharsPerSegment: number;
  remainingInSegment: number;
}

export function calculateSmsSegments(message: string): SegmentCalculation {
  if (!message || message.length === 0) {
    return {
      isUnicode: false,
      charCount: 0,
      segments: 0,
      maxCharsPerSegment: 160,
      remainingInSegment: 160,
    };
  }

  // Check if text is pure GSM-7
  const isGsm7 = GSM_7_REGEX.test(message);
  const isUnicode = !isGsm7;
  const charCount = message.length;

  if (isUnicode) {
    // UCS-2 / Unicode (Amharic, etc.)
    if (charCount <= 70) {
      return {
        isUnicode: true,
        charCount,
        segments: 1,
        maxCharsPerSegment: 70,
        remainingInSegment: 70 - charCount,
      };
    } else {
      const segments = Math.ceil(charCount / 67);
      const remaining = segments * 67 - charCount;
      return {
        isUnicode: true,
        charCount,
        segments,
        maxCharsPerSegment: 67,
        remainingInSegment: remaining,
      };
    }
  } else {
    // Pure GSM-7 (English / Basic Latin)
    if (charCount <= 160) {
      return {
        isUnicode: false,
        charCount,
        segments: 1,
        maxCharsPerSegment: 160,
        remainingInSegment: 160 - charCount,
      };
    } else {
      const segments = Math.ceil(charCount / 153);
      const remaining = segments * 153 - charCount;
      return {
        isUnicode: false,
        charCount,
        segments,
        maxCharsPerSegment: 153,
        remainingInSegment: remaining,
      };
    }
  }
}
