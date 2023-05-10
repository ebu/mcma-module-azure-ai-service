import { Context, ScheduledEvent } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchEventsClient } from "@aws-sdk/client-cloudwatch-events";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";

import { getTableName } from "@mcma/data";
import { AwsCloudWatchLoggerProvider, getLogGroupName } from "@mcma/aws-logger";
import { LambdaWorkerInvoker } from "@mcma/aws-lambda-worker-invoker";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { getWorkerFunctionId } from "@mcma/worker-invoker";
import { JobAssignmentProperties } from "@mcma/core";
import { getPublicUrl } from "@mcma/api";

import { AzureClient, disableEventRule, enableEventRule } from "@local/azure-common";

const { CLOUD_WATCH_EVENT_RULE, CONFIG_FILE_BUCKET, CONFIG_FILE_KEY } = process.env;

const cloudWatchEventsClient = AWSXRay.captureAWSv3Client(new CloudWatchEventsClient({}));
const cloudWatchLogsClient = AWSXRay.captureAWSv3Client(new CloudWatchLogsClient({}));
const dynamoDBClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const lambdaClient = AWSXRay.captureAWSv3Client(new LambdaClient({}));
const s3Client = AWSXRay.captureAWSv3Client(new S3Client({}));

const dbTableProvider = new DynamoDbTableProvider({}, dynamoDBClient);
const loggerProvider = new AwsCloudWatchLoggerProvider("azure-ai-service-periodic-checker", getLogGroupName(),cloudWatchLogsClient);
const workerInvoker = new LambdaWorkerInvoker(lambdaClient);

const azureClient = new AzureClient(CONFIG_FILE_BUCKET, CONFIG_FILE_KEY, s3Client);
const PageSize = 100;

export async function handler(event: ScheduledEvent, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId);
    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        const table = await dbTableProvider.get(getTableName());
        const mutex = table.createMutex({
            name: "azure-ai-service-periodic-checker",
            holder: context.awsRequestId,
            logger: logger,
        });

        if (await mutex.tryLock()) {
            try {
                let totalActive = 0;
                let totalFinished = 0;

                await disableEventRule(CLOUD_WATCH_EVENT_RULE, table, cloudWatchEventsClient, context.awsRequestId, logger);

                try {
                    for (let skip = 0; ; skip += PageSize) {
                        const transcriptions = await azureClient.getTranscriptions(skip, PageSize, logger);

                        for (const transcription of transcriptions.values) {
                            if (transcription.displayName.startsWith(getPublicUrl())) {
                                if (transcription.status === "Succeeded" || transcription.status === "Failed") {
                                    const jobAssignmentDatabaseId = transcription.displayName.substring(getPublicUrl().length);
                                    const jobAssignment = await table.get<JobAssignmentProperties>(jobAssignmentDatabaseId);
                                    if (!jobAssignment) {
                                        await azureClient.deleteTranscription(transcription.self, logger);
                                        continue;
                                    }

                                    logger.info("Invoking worker for jobAssignment " + jobAssignmentDatabaseId);
                                    await workerInvoker.invoke(getWorkerFunctionId(), {
                                        input: {
                                            jobAssignmentDatabaseId,
                                            transcription,
                                        },
                                        operationName: "ProcessTranscriptionCompletion",
                                        tracker: jobAssignment.tracker
                                    });

                                    totalFinished++;
                                } else {
                                    totalActive++;
                                }
                            }
                        }

                        if (!transcriptions["@nextLink"]) {
                            break;
                        }
                    }
                } catch (error) {
                    logger.error(error);
                }

                logger.info(`Processed ${totalFinished + totalActive} transcriptions of which ${totalFinished} are finished and ${totalActive} are still active`);
                if (totalActive > 0) {
                    await enableEventRule(CLOUD_WATCH_EVENT_RULE, table, cloudWatchEventsClient, context.awsRequestId, logger);
                }
            } finally {
                await mutex.unlock();
            }
        }
    } catch (error) {
        logger.error(error);
        throw error;
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}
