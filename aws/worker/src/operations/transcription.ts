import { default as axios } from "axios";

import { ProcessJobAssignmentHelper, ProviderCollection, WorkerRequest } from "@mcma/worker";
import { AIJob, JobStatus, Locator, Logger, ProblemDetail, Utils } from "@mcma/core";

import { enableEventRule } from "@local/azure-common";

import { WorkerContext } from "../index";
import { generateFilePrefix, getFileExtension, writeOutputFile } from "./utils";
import { getTableName } from "@mcma/data";

const { CloudWatchEventRule } = process.env;

export async function transcription(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<AIJob>, ctx: WorkerContext) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("JobInput:");
    logger.info(jobInput);

    const inputFile = jobInput.inputFile as Locator;
    if (!inputFile.url || !Utils.isValidUrl(inputFile.url)) {
        await jobAssignmentHelper.fail(new ProblemDetail({
            type: "uri://mcma.ebu.ch/rfc7807/azure-ai-service/locator-missing-url",
            title: "Provided input file locator is missing 'url' property"
        }));
        return;
    }

    const extension = getFileExtension(inputFile.url, false);
    switch (extension) {
        case "wav":
        case "mp3":
        case "ogg":
            break;
        default:
            await jobAssignmentHelper.fail(new ProblemDetail({
                type: "uri://mcma.ebu.ch/rfc7807/azure-ai-service/file-format-not-accepted",
                title: "Provided input file locator does not have an acceptable format like WAV, MP3, or OGG"
            }));
            return;
    }

    await ctx.azureClient.startTranscription([inputFile.url], jobAssignmentHelper.jobAssignment.id, logger);

    await enableEventRule(CloudWatchEventRule, jobAssignmentHelper.dbTable, ctx.cloudWatchEvents, ctx.awsRequestId, logger);
}

export async function processTranscriptionCompletion(providers: ProviderCollection, workerRequest: WorkerRequest, ctx: WorkerContext) {
    const jobAssignmentHelper = new ProcessJobAssignmentHelper(
        await providers.dbTableProvider.get(getTableName()),
        providers.resourceManagerProvider.get(),
        workerRequest
    );

    const logger = jobAssignmentHelper.logger;

    const table = await providers.dbTableProvider.get(getTableName());
    const mutex = table.createMutex({
        name: jobAssignmentHelper.jobAssignmentDatabaseId,
        holder: ctx.awsRequestId,
        logger: logger,
    });

    const transcription = workerRequest.input.transcription;
    const transcriptionId = transcription?.self;

    await mutex.lock();
    try {
        logger.info(workerRequest.input);

        await jobAssignmentHelper.initialize();

        const jobInput = jobAssignmentHelper.jobInput;

        if (jobAssignmentHelper.jobAssignment.status === JobStatus.Completed ||
            jobAssignmentHelper.jobAssignment.status === JobStatus.Failed ||
            jobAssignmentHelper.jobAssignment.status === JobStatus.Canceled) {
            logger.warn(`Job Assignment is already in final state '${jobAssignmentHelper.jobAssignment.status}'`);

            return;
        }

        if (transcription.status !== "Succeeded") {
            await jobAssignmentHelper.fail({
                type: "uri://mcma.ebu.ch/rfc7807/azure-ai-service/azure-processing-failure",
                title: "Azure Processing Failure",
                transcription,
            });
            return;
        }

        logger.info("Getting transcription files");
        const transcriptionFiles = await ctx.azureClient.getTranscriptionFiles(workerRequest.input.transcription.self, logger);
        logger.info(transcriptionFiles);

        const [transcriptionFile] = transcriptionFiles.values.filter(tf => tf.kind === "Transcription");
        const transcriptionContentResponse = await axios.get(transcriptionFile.links.contentUrl);
        const transcriptionContent = transcriptionContentResponse.data;

        const inputFile = jobInput.inputFile as Locator;
        const jsonOutputFile = await writeOutputFile(generateFilePrefix(inputFile.url) + ".json", transcriptionContent, ctx.s3);

        const webvtt = generateWebVtt(transcriptionContent, logger);
        logger.info(webvtt);

        const webVttOutputFile = await writeOutputFile(generateFilePrefix(inputFile.url) + ".vtt", webvtt, ctx.s3);

        logger.info("Updating job assignment with output");
        jobAssignmentHelper.jobOutput.outputFiles = [
            jsonOutputFile,
            webVttOutputFile
        ];

        await jobAssignmentHelper.complete();
    } catch (error) {
        logger.error(error);
        try {
            await jobAssignmentHelper.fail(new ProblemDetail({
                type: "uri://mcma.ebu.ch/rfc7807/azure-ai-service/generic-failure",
                title: "Generic failure",
                detail: error.message
            }));
        } catch (error) {
            logger.error(error);
        }
    } finally {
        try {
            await ctx.azureClient.deleteTranscription(transcriptionId, logger);
        } catch (error) {
            logger.error(`Failed to delete azure transcription ${transcriptionId}`);
            logger.error(error);
        }
        await mutex.unlock();
    }
}

function generateWebVtt(output: any, logger: Logger) {
    const MAX_CHARS_PER_LINE = 42;

    let webvtt = "WEBVTT";
    let index: number = 0;
    let start: number = -1;
    let end: number = -1;
    let sentence: string = "";

    const recognizedPhrases = output.recognizedPhrases.filter(rp => rp.channel === 0);

    for (const recognizedPhrase of recognizedPhrases) {
        const bestRecognizedPhrase = recognizedPhrase.nBest[0];

        const words = bestRecognizedPhrase.display.split(" ");
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordStats = bestRecognizedPhrase.words[i];

            const testSentence = (sentence + " " + word).trim();

            if (sentence.endsWith(".") || sentence.endsWith("!") || sentence.endsWith("?") || testSentence.length > MAX_CHARS_PER_LINE) {
                webvtt += `\n\n${index++}\n`;
                webvtt += `${formatTimestamp(start)} --> ${formatTimestamp(end)}\n`;
                webvtt += `${sentence}`;

                start = -1;
                end = -1;
                sentence = word;
            } else {
                sentence = testSentence;
            }

            if (wordStats) {
                if (start < 0) {
                    start = wordStats.offsetInTicks / 10000000;
                }
                end = (wordStats.offsetInTicks + wordStats.durationInTicks) / 10000000 - 0.001;
            }
        }
    }

    if (sentence && start >= 0 && end >= 0) {
        webvtt += `\n\n${index++}\n`;
        webvtt += `${formatTimestamp(start)} --> ${formatTimestamp(end)}\n`;
        webvtt += `${sentence}`;
    }
    return webvtt;
}

function formatTimestamp(timestamp: number) {
    timestamp = Math.round(timestamp * 1000);
    const ms = timestamp % 1000;
    timestamp = Math.floor(timestamp / 1000);
    const s = timestamp % 60;
    timestamp = Math.floor(timestamp / 60);
    const m = timestamp % 60;
    timestamp = Math.floor(timestamp / 60);
    const h = timestamp;

    return `${h > 9 ? h : "0" + h}:${m > 9 ? m : "0" + m}:${s > 9 ? s : "0" + s}.${ms > 99 ? ms : ms > 9 ? "0" + ms : "00" + ms}`;
}
