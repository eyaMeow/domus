const appConfig = require('./app.json');
const easProjectId = process.env.EAS_PROJECT_ID || appConfig.expo.extra?.eas?.projectId;

module.exports = {
  ...appConfig,
  expo: {
    ...appConfig.expo,
    extra: {
      ...appConfig.expo.extra,
      eas: {
        ...appConfig.expo.extra?.eas,
        projectId: easProjectId,
      },
    },
    plugins: [
      ...appConfig.expo.plugins,
      '@maplibre/maplibre-react-native',
      ['expo-notifications', { defaultChannel: 'default' }],
    ],
  },
};
