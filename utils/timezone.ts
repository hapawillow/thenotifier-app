/**
 * Get the current timezone ID (IANA format, e.g., "America/New_York")
 */
export const getCurrentTimeZoneId = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    // Fallback to UTC if Intl API fails
    return 'UTC';
  }
};

/**
 * Get the current timezone abbreviation (e.g., "EST", "PST")
 * Falls back to GMT offset if abbreviation is not available
 */
export const getCurrentTimeZoneAbbr = (): string => {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
      timeZone: getCurrentTimeZoneId(),
    });
    
    const parts = formatter.formatToParts(now);
    const timeZoneNamePart = parts.find(part => part.type === 'timeZoneName');
    
    if (timeZoneNamePart && timeZoneNamePart.value) {
      return timeZoneNamePart.value;
    }
    
    // Fallback to GMT offset
    return getCurrentTimeZoneOffset();
  } catch (error) {
    // Fallback to GMT offset on error
    return getCurrentTimeZoneOffset();
  }
};

/**
 * Get the current timezone offset as GMT string (e.g., "GMT-05:00")
 */
export const getCurrentTimeZoneOffset = (): string => {
  try {
    const offset = -new Date().getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset / 60);
    const minutes = absOffset % 60;
    return `GMT${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } catch (error) {
    return 'GMT+00:00';
  }
};

/**
 * Format a date/time in a specific timezone with abbreviation
 * @param date The date to format (ISO string or Date object)
 * @param timeZoneId IANA timezone ID (e.g., "America/New_York")
 * @param timeZoneAbbr The timezone abbreviation to append (e.g., "EST")
 * @returns Formatted string like "1/8/2026, 11:15 AM (EST)"
 */
export const formatDateTimeWithTimeZone = (
  date: Date | string,
  timeZoneId: string | null,
  timeZoneAbbr: string | null
): string => {
  let dateObj: Date;
  
  try {
    // Parse ISO string or use Date object directly
    if (typeof date === 'string') {
      // Try parsing as ISO first (most reliable)
      dateObj = new Date(date);
      // Validate the date is valid
      if (isNaN(dateObj.getTime())) {
        // If ISO parsing fails, try locale string parsing as fallback
        dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          throw new Error('Invalid date string');
        }
      }
    } else {
      dateObj = date;
    }
    
    // If we have a timeZoneId, format using that timezone
    if (timeZoneId) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timeZoneId,
        });
        const dateTimeStr = formatter.format(dateObj);
        
        // Append timezone abbreviation if available
        if (timeZoneAbbr) {
          return `${dateTimeStr} (${timeZoneAbbr})`;
        }
        
        // Try to get timezone name from formatter
        const parts = formatter.formatToParts(dateObj);
        const timeZoneNamePart = parts.find(part => part.type === 'timeZoneName');
        if (timeZoneNamePart && timeZoneNamePart.value) {
          return `${dateTimeStr} (${timeZoneNamePart.value})`;
        }
        
        return dateTimeStr;
      } catch (error) {
        // If timezone formatting fails, fall through to default formatting
      }
    }
    
    // Default formatting (current timezone)
    const dateTimeStr = dateObj.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    
    // Append timezone abbreviation if available
    if (timeZoneAbbr) {
      return `${dateTimeStr} (${timeZoneAbbr})`;
    }
    
    return dateTimeStr;
  } catch (error) {
    // Ultimate fallback - try to format as-is
    try {
      const fallbackDate = typeof date === 'string' ? new Date(date) : date;
      if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate.toLocaleString('en-US');
      }
    } catch (e) {
      // Ignore
    }
    return 'Invalid Date';
  }
};
