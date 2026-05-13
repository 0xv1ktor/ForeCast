import { createForecastApiHandler } from '../../server/arciumStakeService.mjs';

const handler = createForecastApiHandler();

export const config = {
  maxDuration: 60,
};

export default function forecastOddsUpdateApi(req, res) {
  return handler(req, res);
}
