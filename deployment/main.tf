#########################
# Provider registration
#########################

provider "aws" {
  profile = var.aws_profile
  region  = var.aws_region
}

############################################
# Cloud watch log group for central logging
############################################

resource "aws_cloudwatch_log_group" "main" {
  name = "/mcma/${var.global_prefix}"
}

#################################
# Retrieving AWS account details
#################################
data "aws_caller_identity" "current" {}

#########################
# Service Registry Module
#########################

module "service_registry" {
  source = "https://ch-ebu-mcma-module-repository.s3.eu-central-1.amazonaws.com/ebu/service-registry/aws/0.13.28/module.zip"

  prefix = "${var.global_prefix}-service-registry"

  stage_name = var.environment_type

  aws_account_id = data.aws_caller_identity.current.account_id

  aws_region = var.aws_region

  log_group = aws_cloudwatch_log_group.main

  services = [
    module.job_processor.service_definition,
    module.azure_ai_service.service_definition,
  ]
}

#########################
# Job Processor Module
#########################

module "job_processor" {
  source = "https://ch-ebu-mcma-module-repository.s3.eu-central-1.amazonaws.com/ebu/job-processor/aws/0.13.28/module.zip"

  prefix = "${var.global_prefix}-job-processor"

  stage_name     = var.environment_type
  dashboard_name = var.global_prefix

  aws_account_id = data.aws_caller_identity.current.account_id
  aws_region     = var.aws_region

  service_registry = module.service_registry

  log_group = aws_cloudwatch_log_group.main
}

########################################
# Azure AI Service
########################################

module "azure_ai_service" {
  source = "../aws/build/staging"

  prefix = "${var.global_prefix}-azure-ai-service"

  stage_name = var.environment_type
  aws_region = var.aws_region

  service_registry = module.service_registry

  execute_api_arns = [
    "${module.service_registry.aws_apigatewayv2_stage.service_api.execution_arn}/GET/*",
    "${module.job_processor.aws_apigatewayv2_stage.service_api.execution_arn}/*/*",
  ]

  azure_config_file = var.azure_config_file

  log_group = aws_cloudwatch_log_group.main
}

########################################
# Bucket for testing
########################################
resource "aws_s3_bucket" "upload" {
  bucket = "${var.global_prefix}-upload-${var.aws_region}"

  force_destroy = true
}

resource "aws_s3_bucket_lifecycle_configuration" "upload" {
  bucket = aws_s3_bucket.upload.id

  rule {
    id     = "Delete after 1 day"
    status = "Enabled"
    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_public_access_block" "upload" {
  bucket = aws_s3_bucket.upload.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
