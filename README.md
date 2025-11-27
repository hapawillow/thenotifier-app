# The Notifier

The Notifier mobile app written in Expo.

## Installing for local development

1. Clone the repo
2. Run: `npm install` to install dependencies
3. Run: `npx expo install` to install expo dependencies
4. Open `./ios/thenotifier.xcodeproj` in Xcode to confirm the team, bundle ID and provisioning profile are properly configured
5. Make sure our fixes to `rn-native-alarmkit` package are used
   - node_modules/rn-native-alarmkit/ios/AlarmKitManager.swift
   - node_modules/rn-native-alarmkit/src/AlarmManager.ts
6. Run: `npx expo prebulid --clean
7. Run: `npx expo run:ios --device` to run app on the device
   
_**Note**: it is best to test on a device to make sure the notifications work properly_