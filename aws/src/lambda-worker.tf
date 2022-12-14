#################################
# Lambda worker
#################################

locals {
  lambda_name_worker = format("%.64s", replace("${var.prefix}-worker", "/[^a-zA-Z0-9_]+/", "-" ))
  worker_zip_file    = "${path.module}/lambdas/worker.zip"
}

resource "aws_iam_role" "worker" {
  name = format("%.64s", replace("${var.prefix}-${var.aws_region}-worker", "/[^a-zA-Z0-9_]+/", "-" ))
  path = var.iam_role_path

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowLambdaAssumingRole"
        Effect    = "Allow"
        Action    = "sts:AssumeRole"
        Principal = {
          "Service" = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "worker" {
  name = aws_iam_role.worker.name
  role = aws_iam_role.worker.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat([
      {
        Sid      = "DescribeCloudWatchLogs"
        Effect   = "Allow"
        Action   = "logs:DescribeLogGroups"
        Resource = "*"
      },
      {
        Sid    = "WriteToCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = concat([
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${var.log_group.name}:*",
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.lambda_name_worker}:*",
        ], var.enhanced_monitoring_enabled ? [
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda-insights:*",
        ] : [])
      },
      {
        Sid    = "ListAndDescribeDynamoDBTables"
        Effect = "Allow"
        Action = [
          "dynamodb:List*",
          "dynamodb:DescribeReservedCapacity*",
          "dynamodb:DescribeLimits",
          "dynamodb:DescribeTimeToLive",
        ]
        Resource = "*"
      },
      {
        Sid    = "AllowTableOperations"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.service_table.arn
      },
      {
        Sid      = "AllowReadingConfigFile"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${aws_s3_object.config_file.bucket}/${aws_s3_object.config_file.id}"
      },
      {
        Sid      = "AllowGettingBucketLocation"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = var.output_bucket != null ? var.output_bucket.arn : aws_s3_bucket.output[0].arn
      },
      {
        Sid      = "AllowWritingToOutputBucket"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${var.output_bucket != null ? var.output_bucket.arn : aws_s3_bucket.output[0].arn }/${var.output_bucket_prefix}*"
      },
      {
        Sid    = "AllowEnablingDisabling"
        Effect = "Allow"
        Action = [
          "events:DescribeRule",
          "events:EnableRule",
          "events:DisableRule",
        ]
        Resource = aws_cloudwatch_event_rule.periodic_checker.arn
      },
    ],
      var.xray_tracing_enabled ?
      [
        {
          Sid    = "AllowLambdaWritingToXRay"
          Effect = "Allow"
          Action = [
            "xray:PutTraceSegments",
            "xray:PutTelemetryRecords",
            "xray:GetSamplingRules",
            "xray:GetSamplingTargets",
            "xray:GetSamplingStatisticSummaries",
          ]
          Resource = "*"
        }
      ] : [],
      var.dead_letter_config_target != null ?
      [
        {
          Sid      = "AllowLambdaToSendToDLQ"
          Effect   = "Allow"
          Action   = "sqs:SendMessage"
          Resource = var.dead_letter_config_target
        }
      ] : [],
      length(var.execute_api_arns) > 0 ?
      [
        {
          Sid      = "AllowInvokingApiGateway"
          Effect   = "Allow"
          Action   = "execute-api:Invoke"
          Resource = var.execute_api_arns
        },
      ] : [])
  })
}

resource "aws_lambda_function" "worker" {
  depends_on = [
    aws_iam_role_policy.worker
  ]

  function_name    = local.lambda_name_worker
  role             = aws_iam_role.worker.arn
  handler          = "index.handler"
  filename         = local.worker_zip_file
  source_code_hash = filebase64sha256(local.worker_zip_file)
  runtime          = "nodejs14.x"
  timeout          = "900"
  memory_size      = "2048"

  layers = var.enhanced_monitoring_enabled ? ["arn:aws:lambda:${var.aws_region}:580247275435:layer:LambdaInsightsExtension:18"] : []

  environment {
    variables = {
      LogGroupName        = var.log_group.name
      TableName           = aws_dynamodb_table.service_table.name
      PublicUrl           = local.service_url
      ServicesUrl         = var.service_registry.services_url
      ServicesAuthType    = var.service_registry.auth_type
      ConfigFileBucket    = aws_s3_object.config_file.bucket
      ConfigFileKey       = aws_s3_object.config_file.id
      OutputBucket        = var.output_bucket != null ? var.output_bucket.id : aws_s3_bucket.output[0].id
      OutputBucketPrefix  = var.output_bucket_prefix
      CloudWatchEventRule = aws_cloudwatch_event_rule.periodic_checker.name,
    }
  }

  dynamic "dead_letter_config" {
    for_each = var.dead_letter_config_target != null ? toset([1]) : toset([])

    content {
      target_arn = var.dead_letter_config_target
    }
  }

  tracing_config {
    mode = var.xray_tracing_enabled ? "Active" : "PassThrough"
  }

  tags = var.tags
}
