import { default as axios } from "axios";

const { AzureConfigFile } = process.env;

const azureConfigFile = require(AzureConfigFile);

const client = axios.create({
    baseURL: azureConfigFile.transcriptionServiceBaseUrl,
    headers: {
        "Ocp-Apim-Subscription-Key": azureConfigFile.transcriptionServiceSubscriptionKey,
    }
});

export function log(entry?: any) {
    if (typeof entry === "object") {
        console.log(JSON.stringify(entry, null, 2));
    } else {
        console.log(entry);
    }
}

async function main() {
    log("Starting test azure speech to text api");

    const resp = await client.get("/transcriptions");
    log(resp.data);

    // const audioUrl = "https://pt-rovers-mam-dev-ffmpeg-service-output-eu-west-1.s3.eu-west-1.amazonaws.com/ffmpeg-service/2022-08-27T15-48-44/2015_GF_ORF_00_18_09_conv.wav?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIARG4YKR4Q7O6B44CJ%2F20220827%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=20220827T154844Z&X-Amz-Expires=43200&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEHgaCWV1LXdlc3QtMSJHMEUCIAuyYogxhAY4QS8JIUXVRlu6NbT3%2FmPrZBTiryhW1NbhAiEA2RA3hFTgB2SVIm1ohlzOIgNY5JCC6RpSNXmgHRzbOMwqrAMI8f%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARACGgwwODM1MzQ0NTA0NjUiDIV%2FFw0lzZYwCsX4VSqAA%2FOi7PG5R%2FuEs2y%2Fa%2Bx0y9EpvBNhTc52RR%2FeYPQINSNK8H3twnOK9PQntMglUJVlwY6CSxFNJYaIM0Kcfy%2BCaca%2FPbEtB7mCa4sI9J%2F9L4pNn7NpgHX5W2ULVO%2FIMDx5ufTQgp9fMoQQSuTAo0073Pkdzh0jEIVJYa1R440hLRxiVTd2IKsO%2FmAfq47benyKxsGaduzRCV4dh3u1A1DRhLHpabTcUKLmta09mN2e6AeijKaykxDmuz4JCZQxxSBbAg%2Fy9dnw8FKqeZ%2ByTPnYvHAiP9tgHQ44SHSKAnavKUPafwmCi%2BNt3aOINd5azCA683Y3Fzc620YJ3ToJrrcdVXP21X4UKFw6suipipFn%2BvVvvnn%2FU4Vl1Q03cvJdFilVFnck966EW7TDkqF3qO%2BZW6VVhCNVjd3X7LQStac6kewBkwnMoOLkZYbnpi5EkM2DPrhv8sX3UCPo%2BYR4KwFuKEaj1De7XbzC6JbTSje7iygtBHVdb%2FJrYeZm6prOaJl8RTDY%2BaiYBjqdAYAykEI1Y6%2Fa049GyCa8%2FGxhCYtbQQqcX7enTM3BaAZX9gixHFkdGtCWBfvN626OhDkrOS7t4r0hMEQbyo6E%2BtLZI0jMB26de0thMaipBZHzUrBX2fplkVM%2FTZ9tDp5IHjenPRaBvObnIkgMH6r74jUb5eaCR6xR9E2%2BBDK5rQ5C8%2F68h490790hJsx7Ohqnn%2FrdzI9tR%2BWzfIHix94%3D&X-Amz-Signature=aec27c22b50592864babe14e048c0dc5655849af80deabda2e9290ce8fd4a029&X-Amz-SignedHeaders=host";
    //
    // const postResp = await client.post("/transcriptions", {
    //     contentUrls: [
    //         audioUrl
    //     ],
    //     properties: {
    //         wordLevelTimestampsEnabled: true,
    //         punctuationMode: "DictatedAndAutomatic"
    //     },
    //     locale: "en-US",
    //     displayName: "Test"
    // })
    //
    // log (postResp.data);

    // const filesResp = await client.get("https://francecentral.api.cognitive.microsoft.com/speechtotext/v3.0/transcriptions/14a97276-1fe8-4486-9256-9a3cfa58f1fd/files");
    // log(filesResp.data);

    // await client.delete("https://francecentral.api.cognitive.microsoft.com/speechtotext/v3.0/transcriptions/14a97276-1fe8-4486-9256-9a3cfa58f1fd");
}

main().then(() => console.log("Done")).catch(e => console.error(e));
