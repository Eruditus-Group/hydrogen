import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type {AdminSession} from '@shopify/cli-kit/node/session';
import {mockAndCaptureOutput} from '@shopify/cli-kit/node/testing/output';
import {
  renderConfirmationPrompt,
  renderSelectPrompt,
  renderTextPrompt,
} from '@shopify/cli-kit/node/ui';

import {adminRequest} from '../../lib/graphql.js';
import {getStorefronts} from '../../lib/graphql/admin/link-storefront.js';
import {createStorefront} from '../../lib/graphql/admin/create-storefront.js';
import {waitForJob} from '../../lib/graphql/admin/fetch-job.js';
import {getConfig, setStorefront} from '../../lib/shopify-config.js';
import {renderError, renderUserErrors} from '../../lib/user-errors.js';

import {linkStorefront} from './link.js';

const SHOP = 'my-shop';
const ADMIN_SESSION: AdminSession = {
  token: 'abc123',
  storeFqdn: SHOP,
};

vi.mock('@shopify/cli-kit/node/ui', async () => {
  const original = await vi.importActual<
    typeof import('@shopify/cli-kit/node/ui')
  >('@shopify/cli-kit/node/ui');

  return {
    ...original,
    renderConfirmationPrompt: vi.fn(),
    renderSelectPrompt: vi.fn(),
    renderTextPrompt: vi.fn(),
  };
});
vi.mock('../../lib/graphql.js');
vi.mock('../../lib/shopify-config.js');
vi.mock('../../lib/graphql/admin/link-storefront.js');
vi.mock('../../lib/graphql/admin/create-storefront.js');
vi.mock('../../lib/graphql/admin/fetch-job.js');
vi.mock('../../lib/user-errors.js');
vi.mock('../../lib/shop.js', () => ({
  getHydrogenShop: () => SHOP,
}));
vi.mock('../../lib/shell.js', () => ({
  getCliCommand: () => 'h2',
}));

describe('link', () => {
  const outputMock = mockAndCaptureOutput();

  beforeEach(async () => {
    vi.mocked(getStorefronts).mockResolvedValue({
      adminSession: ADMIN_SESSION,
      storefronts: [
        {
          id: 'gid://shopify/HydrogenStorefront/1',
          parsedId: '1',
          title: 'Hydrogen',
          productionUrl: 'https://example.com',
        },
      ],
    });
    vi.mocked(getConfig).mockResolvedValue({});
  });

  afterEach(() => {
    vi.resetAllMocks();
    outputMock.clear();
  });

  it('makes a GraphQL call to fetch the storefronts', async () => {
    await linkStorefront({});

    expect(getStorefronts).toHaveBeenCalledWith(SHOP);
  });

  describe('when you want to link an existing Hydrogen storefront', () => {
    beforeEach(async () => {
      vi.mocked(renderSelectPrompt).mockResolvedValue(
        'gid://shopify/HydrogenStorefront/1',
      );
    });

    it('renders a list of choices and forwards the selection to setStorefront', async () => {
      await linkStorefront({path: 'my-path'});

      expect(setStorefront).toHaveBeenCalledWith(
        'my-path',
        expect.objectContaining({
          id: 'gid://shopify/HydrogenStorefront/1',
          title: 'Hydrogen',
        }),
      );
    });

    it('renders a success message', async () => {
      await linkStorefront({path: 'my-path'});

      expect(outputMock.info()).toMatch(/Hydrogen is now linked/g);
      expect(outputMock.info()).toMatch(
        /Run `h2 dev` to start your local development server and start building/g,
      );
    });
  });

  describe('when you want to link a new Hydrogen storefront', () => {
    const expectedStorefrontName = 'New Storefront';
    const expectedJobId = 'gid://shopify/Job/1';

    beforeEach(async () => {
      vi.mocked(renderSelectPrompt).mockResolvedValue('NEW_STOREFRONT');

      vi.mocked(createStorefront).mockResolvedValue({
        adminSession: ADMIN_SESSION,
        storefront: {
          id: 'gid://shopify/HydrogenStorefront/1',
          title: expectedStorefrontName,
          productionUrl: 'https://example.com',
        },
        userErrors: [],
        jobId: expectedJobId,
      });
    });

    it('chooses to create a new storefront given the directory path', async () => {
      await linkStorefront({path: 'my-path'});

      expect(renderTextPrompt).toHaveBeenCalledWith({
        message: expect.stringMatching(/name/i),
        defaultValue: 'My Path',
      });
    });

    it('chooses to create a new storefront without directory path', async () => {
      await linkStorefront({});

      expect(renderTextPrompt).toHaveBeenCalledWith({
        message: expect.stringMatching(/name/i),
        defaultValue: 'Hydrogen Storefront',
      });
    });

    it('handles the successful creation of the storefront on Admin', async () => {
      await linkStorefront({});

      expect(waitForJob).toHaveBeenCalledWith(SHOP, expectedJobId);

      expect(outputMock.info()).toContain(
        `${expectedStorefrontName} is now linked`,
      );
    });

    it('handles the user-errors when creating the storefront on Admin', async () => {
      const expectedUserErrors = [
        {
          code: 'INVALID',
          field: [],
          message: 'Bad thing happend.',
        },
      ];

      vi.mocked(createStorefront).mockResolvedValue({
        adminSession: ADMIN_SESSION,
        storefront: undefined,
        userErrors: expectedUserErrors,
        jobId: undefined,
      });

      await linkStorefront({});

      expect(waitForJob).not.toHaveBeenCalled();
      expect(renderUserErrors).toHaveBeenCalledWith(expectedUserErrors);
    });

    it('handles the job errors when creating the storefront on Admin', async () => {
      vi.mocked(waitForJob).mockRejectedValue(undefined);

      await linkStorefront({});

      expect(renderError).toHaveBeenCalled();
    });
  });

  describe('when there are no Hydrogen storefronts', () => {
    it('renders a message and returns early', async () => {
      vi.mocked(getStorefronts).mockResolvedValue({
        adminSession: ADMIN_SESSION,
        storefronts: [],
      });

      await linkStorefront({});

      expect(outputMock.info()).toMatch(
        /There are no Hydrogen storefronts on your Shop/g,
      );

      expect(renderSelectPrompt).not.toHaveBeenCalled();
      expect(setStorefront).not.toHaveBeenCalled();
    });
  });

  describe('when no storefront gets selected', () => {
    it('does not call setStorefront', async () => {
      vi.mocked(renderSelectPrompt).mockResolvedValue('');

      await linkStorefront({});

      expect(setStorefront).not.toHaveBeenCalled();
    });
  });

  describe('when a linked storefront already exists', () => {
    beforeEach(() => {
      vi.mocked(getConfig).mockResolvedValue({
        storefront: {
          id: 'gid://shopify/HydrogenStorefront/2',
          title: 'Existing Link',
        },
      });
    });

    it('prompts the user to confirm', async () => {
      vi.mocked(renderConfirmationPrompt).mockResolvedValue(true);

      await linkStorefront({});

      expect(renderConfirmationPrompt).toHaveBeenCalledWith({
        message: expect.stringMatching(
          /Do you want to link to a different Hydrogen storefront on Shopify\?/,
        ),
      });
    });

    describe('and the user cancels', () => {
      it('returns early', async () => {
        vi.mocked(renderConfirmationPrompt).mockResolvedValue(false);

        await linkStorefront({});

        expect(adminRequest).not.toHaveBeenCalled();
        expect(setStorefront).not.toHaveBeenCalled();
      });
    });

    describe('and the --force flag is provided', () => {
      it('does not prompt the user to confirm', async () => {
        await linkStorefront({force: true});

        expect(renderConfirmationPrompt).not.toHaveBeenCalled();
      });
    });
  });

  describe('when the --storefront flag is provided', () => {
    it('does not prompt the user to make a selection', async () => {
      await linkStorefront({path: 'my-path', storefront: 'Hydrogen'});

      expect(renderSelectPrompt).not.toHaveBeenCalled();
      expect(setStorefront).toHaveBeenCalledWith(
        'my-path',
        expect.objectContaining({
          id: 'gid://shopify/HydrogenStorefront/1',
          title: 'Hydrogen',
        }),
      );
    });

    describe('and there is no matching storefront', () => {
      it('renders a warning message and returns early', async () => {
        const outputMock = mockAndCaptureOutput();

        await linkStorefront({storefront: 'Does not exist'});

        expect(setStorefront).not.toHaveBeenCalled();

        expect(outputMock.warn()).toMatch(/Couldn\'t find Does not exist/g);
      });
    });
  });
});
