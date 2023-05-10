import { Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";
import { CloudWatchEventsClient } from "@aws-sdk/client-cloudwatch-events";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

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

import { AzureClient } from "@local/azure-common";

const { CONFIG_FILE_BUCKET, CONFIG_FILE_KEY } = process.env;

const cloudWatchEventsClient = AWSXRay.captureAWSv3Client(new CloudWatchEventsClient({}));
const cloudWatchLogsClient = AWSXRay.captureAWSv3Client(new CloudWatchLogsClient({}));
const dynamoDBClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const s3Client = AWSXRay.captureAWSv3Client(new S3Client({}));

const authProvider = new AuthProvider().add(awsV4Auth());
const dbTableProvider = new DynamoDbTableProvider({}, dynamoDBClient);
const loggerProvider = new AwsCloudWatchLoggerProvider("azure-ai-service-worker", getLogGroupName(), cloudWatchLogsClient);
const resourceManagerProvider = new ResourceManagerProvider(authProvider);

const azureClient = new AzureClient(CONFIG_FILE_BUCKET, CONFIG_FILE_KEY, s3Client);

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
            azureClient,
            s3Client,
            cloudWatchEventsClient,
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
    azureClient: AzureClient
    s3Client: S3Client
    cloudWatchEventsClient: CloudWatchEventsClient
}
