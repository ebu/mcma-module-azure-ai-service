import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";

import { v4 as uuidv4 } from "uuid";
import * as AWS from "aws-sdk";

import { AuthProvider, ResourceManager, ResourceManagerConfig } from "@mcma/client";
import { AIJob, Job, JobParameterBag, JobProfile, JobStatus, McmaException, McmaTracker, Utils } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { awsV4Auth } from "@mcma/aws-client";

const { AwsProfile, AwsRegion } = process.env;

AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: AwsProfile });
AWS.config.region = AwsRegion;

const JOB_PROFILE = "AzureTranscription";

const TERRAFORM_OUTPUT = "../../deployment/terraform.output.json";

const MEDIA_FILE = "../test.wav";

const s3 = new AWS.S3();

export function log(entry?: any) {
    if (typeof entry === "object") {
        console.log(JSON.stringify(entry, null, 2));
    } else {
        console.log(entry);
    }
}

async function uploadFileToBucket(bucket: string, filename: string) {
    const fileStream = fs.createReadStream(filename);
    fileStream.on("error", function (err) {
        console.log("File Error", err);
    });

    const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: bucket,
        Key: path.basename(filename),
        Body: fileStream,
        ContentType: mime.lookup(filename) || "application/octet-stream"
    };

    let isPresent = true;

    try {
        console.log("checking if file is already present");
        await s3.headObject({ Bucket: uploadParams.Bucket, Key: uploadParams.Key }).promise();
        console.log("Already present. Not uploading again");
    } catch (error) {
        isPresent = false;
    }

    if (!isPresent) {
        console.log("Not present. Uploading");
        await s3.upload(uploadParams).promise();
    }

    return new S3Locator({
        url: s3.getSignedUrl("getObject", {
            Bucket: uploadParams.Bucket,
            Key: uploadParams.Key,
            Expires: 3600
        })
    });
}

async function waitForJobCompletion(job: Job, resourceManager: ResourceManager): Promise<Job> {
    console.log("Job is " + job.status);

    while (job.status !== JobStatus.Completed &&
           job.status !== JobStatus.Failed &&
           job.status !== JobStatus.Canceled) {

        await Utils.sleep(1000);
        job = await resourceManager.get<Job>(job.id);
        console.log("Job is " + job.status);
    }

    return job;
}

async function startJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let [jobProfile] = await resourceManager.query(JobProfile, { name: JOB_PROFILE });

    // if not found bail out
    if (!jobProfile) {
        throw new McmaException(`JobProfile '${JOB_PROFILE}' not found`);
    }

    let job = new AIJob({
        jobProfileId: jobProfile.id,
        jobInput: new JobParameterBag({
            inputFile
        }),
        tracker: new McmaTracker({
            "id": uuidv4(),
            "label": `Test - ${JOB_PROFILE}`
        })
    });

    return resourceManager.create(job);
}

async function testJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let job;

    console.log("Creating job");
    job = await startJob(resourceManager, inputFile);

    console.log("job.id = " + job.id);
    job = await waitForJobCompletion(job, resourceManager);

    console.log(JSON.stringify(job, null, 2));
}

async function main() {
    console.log("Starting test service");

    const terraformOutput = JSON.parse(fs.readFileSync(TERRAFORM_OUTPUT, "utf8"));
    const uploadBucket = terraformOutput.upload_bucket.value;

    const servicesUrl = terraformOutput.service_registry.value.services_url;
    const servicesAuthType = terraformOutput.service_registry.value.auth_type;

    const resourceManagerConfig: ResourceManagerConfig = {
        servicesUrl,
        servicesAuthType,
    };

    const resourceManager = new ResourceManager(resourceManagerConfig, new AuthProvider().add(awsV4Auth(AWS)));

    console.log(`Uploading media file ${MEDIA_FILE}`);
    const mediaFileLocator = await uploadFileToBucket(uploadBucket, MEDIA_FILE);

    await testJob(resourceManager, mediaFileLocator);
}

main().then(() => console.log("Done")).catch(e => console.error(e));
