import { Context, ScheduledEvent } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";

import { getTableName } from "@mcma/data";
import { AwsCloudWatchLoggerProvider } from "@mcma/aws-logger";
import { LambdaWorkerInvoker } from "@mcma/aws-lambda-worker-invoker";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { getWorkerFunctionId } from "@mcma/worker-invoker";
import { JobAssignmentProperties } from "@mcma/core";

import { AzureClient, disableEventRule, enableEventRule } from "@local/azure-common";

const { CloudWatchEventRule, ConfigFileBucket, ConfigFileKey, LogGroupName, PublicUrl } = process.env;

const AWS = AWSXRay.captureAWS(require("aws-sdk"));
const s3 = new AWS.S3();
const cloudWatchEvents = new AWS.CloudWatchEvents();

const dbTableProvider = new DynamoDbTableProvider({}, new AWS.DynamoDB());
const loggerProvider = new AwsCloudWatchLoggerProvider("azure-ai-service-periodic-checker", LogGroupName, new AWS.CloudWatchLogs());
const workerInvoker = new LambdaWorkerInvoker(new AWS.Lambda());

const azureClient = new AzureClient(ConfigFileBucket, ConfigFileKey, s3);
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

                await disableEventRule(CloudWatchEventRule, table, cloudWatchEvents, context.awsRequestId, logger);

                try {
                    for (let skip = 0; ; skip += PageSize) {
                        const transcriptions = await azureClient.getTranscriptions(skip, PageSize, logger);

                        for (const transcription of transcriptions.values) {
                            if (transcription.displayName.startsWith(PublicUrl)) {
                                if (transcription.status === "Succeeded" || transcription.status === "Failed") {
                                    const jobAssignmentDatabaseId = transcription.displayName.substring(PublicUrl.length);
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
                    await enableEventRule(CloudWatchEventRule, table, cloudWatchEvents, context.awsRequestId, logger);
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
