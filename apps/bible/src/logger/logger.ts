import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.splat(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'scraping.log' }),
  ],
});

export { logger };
