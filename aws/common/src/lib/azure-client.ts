import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Logger, McmaException } from "@mcma/core";
import { default as axios, AxiosInstance } from "axios";

type AzureConfigFile = {
    transcriptionServiceBaseUrl: string
    transcriptionServiceSubscriptionKey: string
}

export class AzureClient {
    private configFileETag: string;
    private configFileRefreshTimestamp: number;

    private transcriptionClient: AxiosInstance;

    constructor(private configFileS3Bucket: string, private configFileS3Key: string, private s3Client: S3Client) {
        this.configFileETag = "";
        this.configFileRefreshTimestamp = 0;
    }

    private async loadConfig(logger: Logger) {
        try {
            if (Date.now() < this.configFileRefreshTimestamp) {
                return;
            }

            this.configFileRefreshTimestamp = Date.now() + 300000; // Check for new file not more often than once every 5 minutes

            logger.info(`Fetching config file from S3 bucket '${this.configFileS3Bucket}' with key '${this.configFileS3Key}`);
            const data = await this.s3Client.send(new GetObjectCommand({
                Bucket: this.configFileS3Bucket,
                Key: this.configFileS3Key,
                IfNoneMatch: this.configFileETag
            }));

            if (this.configFileETag) {
                logger.info("New config file detected");
            }

            this.configFileETag = data.ETag;

            logger.info("Loading config file");
            const configFile: AzureConfigFile = JSON.parse(await data.Body.transformToString());

            if (configFile.transcriptionServiceSubscriptionKey && configFile.transcriptionServiceBaseUrl) {
                this.transcriptionClient = axios.create({
                    baseURL: configFile.transcriptionServiceBaseUrl,
                    headers: {
                        "Ocp-Apim-Subscription-Key": configFile.transcriptionServiceSubscriptionKey,
                    }
                });
            } else {
                this.transcriptionClient = undefined;
            }
        } catch (error) {
            if (error.$metadata?.httpStatusCode === 304) { // NotModified
                logger.info("Config file not modified since last load");
                return;
            }

            this.configFileRefreshTimestamp = 0;
            this.configFileETag = null;

            logger.error(error);
            throw new McmaException(`Failed to load config file from S3 bucket '${this.configFileS3Bucket}' with key '${this.configFileS3Key}'. ${error.message}`, error);
        }
    }

    private assertTranscriptionConfigured() {
        if (!this.transcriptionClient) {
            throw new McmaException("Azure Transcription not configured");
        }
    }

    async startTranscription(contentUrls: string[], displayName: string, logger: Logger) {
        await this.loadConfig(logger);
        this.assertTranscriptionConfigured();

        const response = await this.transcriptionClient.post("/transcriptions", {
            contentUrls,
            properties: {
                wordLevelTimestampsEnabled: true,
                channels: [0],
            },
            locale: "en-US",
            displayName,
        });
        logger.info(response.data);
    }

    async getTranscriptions(skip: number, top: number, logger: Logger) {
        await this.loadConfig(logger);
        this.assertTranscriptionConfigured();

        const response = await this.transcriptionClient.get("/transcriptions", {
            params: {
                skip,
                top
            }
        });
        return response.data;
    }

    async getTranscriptionFiles(transcriptionId: string, logger: Logger) {
        await this.loadConfig(logger);
        this.assertTranscriptionConfigured();

        const response = await this.transcriptionClient.get(`${transcriptionId}/files`);
        return response.data;
    }

    async deleteTranscription(transcriptionId: string, logger: Logger) {
        await this.loadConfig(logger);
        this.assertTranscriptionConfigured();

        await this.transcriptionClient.delete(transcriptionId);
    }
}
