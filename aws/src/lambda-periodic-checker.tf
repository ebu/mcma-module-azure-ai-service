##############################
# Lambda periodic-checker
##############################

locals {
  lambda_name_periodic_checker = format("%.64s", replace("${var.prefix}-periodic-checker", "/[^a-zA-Z0-9_]+/", "-" ))
  periodic_checker_zip_file    = "${path.module}/lambdas/periodic-checker.zip"
}

resource "aws_iam_role" "periodic_checker" {
  name = format("%.64s", replace("${var.prefix}-${var.aws_region}-periodic-checker", "/[^a-zA-Z0-9_]+/", "-" ))
  path = var.iam_role_path

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowLambdaAssumingRole"
        Effect    = "Allow"
        Action    = "sts:AssumeRole",
        Principal = {
          "Service" = "lambda.amazonaws.com"
        }
      }
    ]
  })

  permissions_boundary = var.iam_permissions_boundary

  tags = var.tags
}

resource "aws_iam_role_policy" "periodic_checker" {
  name = aws_iam_role.periodic_checker.name
  role = aws_iam_role.periodic_checker.id

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
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.lambda_name_periodic_checker}:*",
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
        Sid      = "AllowInvokingWorkerLambda"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.worker.arn
      },
      {
        Sid      = "AllowReadingConfigFile"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${aws_s3_object.config_file.bucket}/${aws_s3_object.config_file.id}"
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
      ] : [])
  })
}

resource "aws_lambda_function" "periodic_checker" {
  depends_on = [
    aws_iam_role_policy.periodic_checker
  ]

  function_name    = local.lambda_name_periodic_checker
  role             = aws_iam_role.periodic_checker.arn
  handler          = "index.handler"
  filename         = local.periodic_checker_zip_file
  source_code_hash = filebase64sha256(local.periodic_checker_zip_file)
  runtime          = "nodejs18.x"
  timeout          = "900"
  memory_size      = "2048"

  layers = var.enhanced_monitoring_enabled && contains(keys(local.lambda_insights_extensions), var.aws_region) ? [
    local.lambda_insights_extensions[var.aws_region]
  ] : []

  environment {
    variables = {
      MCMA_LOG_GROUP_NAME     = var.log_group.name
      MCMA_TABLE_NAME         = aws_dynamodb_table.service_table.name
      MCMA_PUBLIC_URL         = local.service_url
      MCMA_WORKER_FUNCTION_ID = aws_lambda_function.worker.function_name
      CONFIG_FILE_BUCKET      = aws_s3_object.config_file.bucket
      CONFIG_FILE_KEY         = aws_s3_object.config_file.id
      CLOUD_WATCH_EVENT_RULE  = aws_cloudwatch_event_rule.periodic_checker.name
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

resource "aws_cloudwatch_event_rule" "periodic_checker" {
  name                = format("%.64s", "${var.prefix}-periodic-checker")
  schedule_expression = "cron(0/1 * * * ? *)"
  is_enabled          = false

  lifecycle {
    ignore_changes = [is_enabled]
  }

  tags = var.tags
}

resource "aws_lambda_permission" "periodic_checker" {
  statement_id  = "AllowEventBridgePeriodic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.periodic_checker.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.periodic_checker.arn
}

resource "aws_cloudwatch_event_target" "periodic_checker" {
  arn  = aws_lambda_function.periodic_checker.arn
  rule = aws_cloudwatch_event_rule.periodic_checker.name
}
