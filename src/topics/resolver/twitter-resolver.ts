/* istanbul ignore file */
import axios from "axios";
import { IResolver } from "./resolver";
import {
  resolveAccount,
  withConcurrency,
  handleResolvingErrors,
} from "./utils";
import { FetchedData } from "topics/group";

export class TwitterResolver implements IResolver {
  twitterUrl: string;

  twitterHeaders: { Authorization: string }[] = [];

  resolvedAccounts: FetchedData = {};

  ignoreAccountErrorsWhenResolving = process.env.SH_IGNORE_RESOLVING_ERRORS;

  constructor(twitterApiKey = process.env.TWITTER_API_KEY) {
    this.twitterUrl = "https://api.twitter.com/";
    const twitterApiKeys = twitterApiKey?.split(",") ?? [];
    twitterApiKeys.map((key) => {
      this.twitterHeaders.push({
        Authorization: `Bearer ${key}`,
      });
    });
  }

  public resolve = async (twitterData: FetchedData): Promise<FetchedData> => {
    // extract twitter usernames already resolved
    let twitterDataUpdated = Object.entries(twitterData).filter(
      ([account, value]) => {
        const splitTwitterData = account.split(":");
        if (splitTwitterData.length === 3) {
          const id = account.split(":")[2];
          this.resolvedAccounts[resolveAccount("1002", id)] = value;
        }
        return splitTwitterData.length !== 3;
      }
    );

    // remove 'twitter:' from the accounts
    twitterDataUpdated = twitterDataUpdated.map((data) => {
      return [data[0].split(":")[1], data[1]];
    });

    // get only the twitter usernames
    const twitterUsernames = twitterDataUpdated.map((data) => {
      return data[0];
    });

    const resolveTwitterHandles = async (data: string[]): Promise<void> => {
      const res = await this.resolveTwitterHandlesQuery(data);
      if (res !== undefined) {
        if (res.data && res.data.data) {
          res.data.data.forEach((user: any) => {
            const account = twitterDataUpdated.find(
              ([account]) => account === user.username
            );
            if (account) {
              this.resolvedAccounts[resolveAccount("1002", user.id)] =
                account[1];
            }
          });
        } else if (res.data.errors) {
          // when only 1 account is resolved, the client don't catch the error
          res.data.errors.forEach((error: any) => {
            if (error.detail) {
              handleResolvingErrors(error.detail);
            }
          });
        }
      }
    };

    await withConcurrency(twitterUsernames, resolveTwitterHandles, {
      concurrency: 20,
      batchSize: 100,
    });

    return this.resolvedAccounts;
  };

  public async resolveTwitterHandlesQuery(twitterData: string[]): Promise<any> {
    const res = await axios({
      url: `${this.twitterUrl}2/users/by?usernames=${twitterData.join(",")}`,
      method: "GET",
      headers:
        this.twitterHeaders[
          Math.floor(Math.random() * this.twitterHeaders.length)
        ],
    }).catch((error) => {
      if (error.response.data.title.includes("Unauthorized")) {
        throw new Error(
          "Twitter API Key (Bearer Token) invalid or not setup properly. It should be setup as an .env variable called TWITTER_API_KEY.\nYou can go here to register your Twitter API Key (Bearer Token): https://developer.twitter.com/en/docs/authentication/oauth-2-0/application-only.\n"
        );
      } else if (error.response.data.title.includes("Too Many Requests")) {
        throw new Error(
          `Too many requests to Twitter API (${
            error.response.headers["x-rate-limit-limit"]
          } requests). The reset time is at ${new Date(
            error.response.headers["x-rate-limit-reset"] * 1000
          )}`
        );
      }
      if (error.response.data.detail) {
        handleResolvingErrors(
          "Twitter Error detail: " +
            error.response.data.detail +
            ` Error while fetching ${twitterData}. Are they existing twitter handles?`
        );
      } else {
        handleResolvingErrors(
          `Error while fetching ${twitterData}. Are they existing twitter handles?`
        );
      }
      return undefined;
    });

    return res;
  }
}
