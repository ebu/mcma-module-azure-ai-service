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

    // const audioUrl = "https://ebu-mcma-google-ai-upload-eu-west-1.s3.eu-west-1.amazonaws.com/test.wav?response-content-disposition=inline&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEMz%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaDGV1LWNlbnRyYWwtMSJHMEUCIBAjOWZD5zaHecHP3sjxMnK9kThf5Pl3aUvjtH%2BQ%2BfQxAiEAjJMjX7if6uhASxFrY0bw%2FfGPxfOBtqJoAktooUkn6T0q%2BwIIRRACGgwwODM1MzQ0NTA0NjUiDGfJLYTXY6XNY7mWzyrYAvqf2n0tZ7QylfKs1em%2BLf7sooIenxdAb5V5HyTr89xCvS4hxz627zBPCVPtrX80ulPADSrr13Gv%2Bs4r0pPuXYe4GG4UqCpG81JIJCZOwxbUFAaIHgdIzmT9jGgy6yf5oZ4gkSjQV7ML91w5buNM2AUX%2BJRXKkF1uJ0LY5MMYrzlMRcBCE3N7kUmjNzdE4osWWQAtaX4JoHLbr%2B0G9ydtb59Sc3tp%2F73Etul0N9fEXya08dqzi0lr45zNUbIkuWWyKj1me8nxC2sT3txsAs1fo%2FDuRYCZDGvgsTx5b0FvfXyLNrf10qzBBxZy%2FPYj1vfOABwH2ngW3fjDqtp8JtBstLcG5KM3mJLkZ6OfEGsZHlolrAq5sVT0e47gqILGmXQ0CgfpGJpt91fezOUg2CnB0AU7PdlaXrBGvxYQ4%2BNwKdazFHF8X68aVowbEpMmc4NeTBoWfMdSNPGMKyhg5gGOrMClyCxf7f%2FMnbJ8s6bg%2FOeAWsEWR14bk9dW7jfW3mSlRfRaNJJPB57OkVgQnqDT237noq2KmQWg2MMVPOAu%2BK2%2FI6hyY9ifvZOSuwYoatgkTHAo0QB2O6ZmBoXII5xRpW3RN%2BI0yaZHm%2FQ3Wfgmh19e9fbRPw%2BRQwx4MpcQEHMI2lhJ3xVIRCvCHHrZzbRPCp7VIACwksp1FG1QeXSJh3n805ErXJI%2BlDvXuEkEaDro2RVA7fu8JTBoceFX0y5Vu8Vg6mV4OH0LynGO%2Fdl3Tda4oVKnl%2FXv97eNCP%2BECRPVclN38YqyyU0GyDQG1iR8Qjkp3m79dWLQM2vzBUoYmmeRPaws0sak8irr7qDRPSF3p4snlHtKFUiFuPo%2B7HadYZDscckw80%2BMrV0mflWzFfuVNYDOQ%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20220820T121834Z&X-Amz-SignedHeaders=host&X-Amz-Expires=43200&X-Amz-Credential=ASIARG4YKR4QTZXRIKOE%2F20220820%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Signature=9ea0f02e5efad830c475914f251e4fc43662eccd5bea12944c0df4d91aacba59";

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

    // const filesResp = await client.get("/transcriptions/fb9ae3df-9a4b-4d73-b4fb-ef587852564c/files");
    // log(filesResp.data);

}

main().then(() => console.log("Done")).catch(e => console.error(e));
