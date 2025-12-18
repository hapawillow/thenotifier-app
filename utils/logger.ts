import Constants from 'expo-constants';

// Get app version from Expo config
const getAppVersion = (): string => {
  try {
    return Constants.expoConfig?.version || Constants.manifest2?.extra?.expoClient?.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

// Helper function to output structured JSON log
const outputStructuredLog = (
  level: 'info' | 'error',
  logHeader: { ver: string; file: string; fn?: string },
  args: any[]
) => {
  const timestamp = new Date().toISOString();
  
  // Create structured log object
  const logEntry = {
    ts: timestamp,
    level: level,
    logHeader: logHeader,
    args: args.length > 0 ? args : undefined,
  };
  
  // Output as single-line JSON
  console.log(JSON.stringify(logEntry));
};

// Create wrapper logger that captures arguments and outputs structured JSON
// Using severity='info' means we output info and error levels
export const logger = {
  info: (logHeader: { ver: string; file: string; fn?: string }, ...args: any[]) => {
    outputStructuredLog('info', logHeader, args);
  },
  
  error: (logHeader: { ver: string; file: string; fn?: string }, ...args: any[]) => {
    outputStructuredLog('error', logHeader, args);
  },
};

// Helper function to create logHeader
export const makeLogHeader = (file: string, fn?: string): { ver: string; file: string; fn?: string } => {
  const header: { ver: string; file: string; fn?: string } = {
    ver: getAppVersion(),
    file,
  };
  
  if (fn) {
    header.fn = fn;
  }
  
  return header;
};

