/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { PlaywrightBlocker } from '@cliqz/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';

import { logger } from '@/logger/logger';
import prisma from '@/prisma/prisma';

const getVersion = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  // NOTE: Ad-blocker
  const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
  await blocker.enableBlockingInPage(page);

  await retry(
    async () => {
      await page.goto('https://www.biblegateway.com/versions/');
    },
    {
      retries: 5,
    },
  );

  const versions = await page
    .getByRole('row')
    .filter({ hasNot: page.locator('css=th') })
    .all();

  // NOTE: The versionCode is the part inside the parentheses
  const reVersionCode = /\(([\w|-]+)\)/;

  // NOTE: The first row will store the langName, for next rows which don't have
  // info about the langName, we will use the langName from the first row.
  let langName: string | null = null;

  for (const row of versions) {
    const langCode = await row.getAttribute('data-language');

    if ((await row.locator('css=[data-target]').count()) > 0) {
      langName = await row.locator('css=[data-target]').innerText();
    }

    if (!langCode || !langName) {
      continue;
    }

    const langData = await prisma.versionLanguage.upsert({
      where: {
        code_webOrigin: {
          code: langCode,
          webOrigin: 'https://www.biblegateway.com',
        },
      },
      update: {
        code: langCode,
        name: langName,
        webOrigin: 'https://www.biblegateway.com',
      },
      create: {
        code: langCode,
        name: langName,
        webOrigin: 'https://www.biblegateway.com',
      },
    });

    const colVersion = row.locator('css=[data-translation]');

    const versionName = await colVersion.textContent();

    const versionCode = versionName?.match(reVersionCode)?.[1];

    const colFormat = row.getByRole('cell').last();
    const colFormatText = (await colFormat.textContent())?.toLowerCase();

    // REVIEW: Currently, we gonna skip the row if the row doesn't have a versionCode
    if (!versionCode || !versionName) {
      continue;
    }

    const onlyNT = colFormatText?.includes('nt') || false;
    const onlyOT = colFormatText?.includes('ot') || false;
    const withApocrypha = colFormatText?.includes('apocrypha') || false;

    const version = await prisma.version.upsert({
      where: {
        code_languageId: {
          code: versionCode,
          languageId: langData.id,
        },
      },
      update: {
        code: versionCode,
        name: versionName,
        language: {
          connect: {
            id: langData.id,
          },
        },
        onlyNT,
        onlyOT,
        withApocrypha,
      },
      create: {
        code: versionCode,
        name: versionName,
        language: {
          connect: {
            id: langData.id,
          },
        },
        onlyNT,
        onlyOT,
        withApocrypha,
      },
    });

    const formats: {
      type: string;
      ref: string;
    }[] = [];

    if ((await colVersion.getByRole('link').count()) > 0) {
      const bookRef = await colVersion.getByRole('link').getAttribute('href');

      if (bookRef) {
        formats.push({
          type: 'ebook',
          ref: bookRef,
        });
      }
    }

    if (
      versionName.toLowerCase() !== colFormatText &&
      (await colFormat.getByRole('link').count()) > 0
    ) {
      const ref = await colFormat.getByRole('link').getAttribute('href');
      let type = null;

      if (colFormatText?.includes('audio')) {
        type = 'audio';
      } else if (colFormatText?.includes('pdf')) {
        type = 'pdf';
      } else {
        type = 'other';
      }

      if (ref) {
        formats.push({
          type,
          ref,
        });
      }
    }

    for (const format of formats) {
      await prisma.versionFormat.upsert({
        where: {
          versionId: version.id,
          type_ref: {
            type: format.type,
            ref: `https://www.biblegateway.com${format.ref}`,
          },
        },
        update: {
          type: format.type,
          ref: `https://www.biblegateway.com${format.ref}`,
          version: {
            connect: {
              code_languageId: {
                code: versionCode,
                languageId: langData.id,
              },
            },
          },
        },
        create: {
          type: format.type,
          ref: `https://www.biblegateway.com${format.ref}`,
          version: {
            connect: {
              code_languageId: {
                code: versionCode,
                languageId: langData.id,
              },
            },
          },
        },
      });

      logger.info('Get format %s for version %s', format.type, versionName);
    }
  }

  await context.close();
  await browser.close();
};

export { getVersion };
