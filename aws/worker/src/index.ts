import { Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";

import { AuthProvider, ResourceManagerProvider } from "@mcma/client";
import { ProcessJobAssignmentOperation, ProviderCollection, Worker, WorkerRequest, WorkerRequestProperties } from "@mcma/worker";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { AwsCloudWatchLoggerProvider, getLogGroupName } from "@mcma/aws-logger";
import { awsV4Auth } from "@mcma/aws-client";
import { AIJob } from "@mcma/core";
import {
    processTranscriptionCompletion,
    transcription
} from "./operations";
import { CloudWatchEvents, S3 } from "aws-sdk";

import { AzureClient } from "@local/azure-common";

const { CONFIG_FILE_BUCKET, CONFIG_FILE_KEY } = process.env;

const AWS = AWSXRay.captureAWS(require("aws-sdk"));

const authProvider = new AuthProvider().add(awsV4Auth(AWS));
const dbTableProvider = new DynamoDbTableProvider();
const loggerProvider = new AwsCloudWatchLoggerProvider("azure-ai-service-worker", getLogGroupName());
const resourceManagerProvider = new ResourceManagerProvider(authProvider);

const s3 = new AWS.S3({ signatureVersion: "v4" });
const cloudWatchEvents = new AWS.CloudWatchEvents();

const azureClient = new AzureClient(CONFIG_FILE_BUCKET, CONFIG_FILE_KEY, s3);

const providerCollection = new ProviderCollection({
    authProvider,
    dbTableProvider,
    loggerProvider,
    resourceManagerProvider
});

const processJobAssignmentOperation =
    new ProcessJobAssignmentOperation(AIJob)
        .addProfile("AzureTranscription", transcription);

const worker =
    new Worker(providerCollection)
        .addOperation(processJobAssignmentOperation)
        .addOperation("ProcessTranscriptionCompletion", processTranscriptionCompletion);

export async function handler(event: WorkerRequestProperties, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId, event.tracker);

    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        await worker.doWork(new WorkerRequest(event, logger), {
            awsRequestId: context.awsRequestId,
            s3,
            azureClient,
            cloudWatchEvents,
        });
    } catch (error) {
        logger.error("Error occurred when handling operation '" + event.operationName + "'");
        logger.error(error.toString());
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}

export type WorkerContext = {
    awsRequestId: string
    s3: S3
    azureClient: AzureClient
    cloudWatchEvents: CloudWatchEvents
}
