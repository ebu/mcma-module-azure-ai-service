####################################
#  Config bucket
####################################

locals {
  bucket_name_config = "${var.prefix}-config-${var.aws_region}"
}

resource "aws_s3_bucket" "config" {
  count = var.config_bucket == null ? 1 : 0

  bucket        = local.bucket_name_config
  force_destroy = true

  lifecycle {
    ignore_changes = [
      logging,
      server_side_encryption_configuration,
    ]
  }
}

resource "aws_s3_bucket_policy" "config" {
  count  = length(aws_s3_bucket.config)
  bucket = aws_s3_bucket.config[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyHttpRequests",
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [
          "arn:aws:s3:::${local.bucket_name_config}",
          "arn:aws:s3:::${local.bucket_name_config}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid       = "DenyDeprecatedTlsRequests",
        Effect    = "Deny",
        Principal = "*",
        Action    = "s3:*",
        Resource  = [
          "arn:aws:s3:::${local.bucket_name_config}",
          "arn:aws:s3:::${local.bucket_name_config}/*"
        ],
        Condition = {
          NumericLessThan = {
            "s3:TlsVersion" = "1.2"
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "config" {
  count  = length(aws_s3_bucket.config)
  bucket = aws_s3_bucket.config[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "config" {
  count  = length(aws_s3_bucket.config)
  bucket = aws_s3_bucket.config[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

####################################
#  Output bucket
####################################
locals {
  bucket_name_output = "${var.prefix}-output-${var.aws_region}"
}

resource "aws_s3_bucket" "output" {
  count = var.output_bucket == null ? 1 : 0

  bucket = local.bucket_name_output

  force_destroy = true

  tags = var.tags
}

resource "aws_s3_bucket_policy" "output" {
  count = var.output_bucket == null ? 1 : 0

  bucket = aws_s3_bucket.output[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyHttpRequests",
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [
          "arn:aws:s3:::${local.bucket_name_output}",
          "arn:aws:s3:::${local.bucket_name_output}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid       = "DenyDeprecatedTlsRequests",
        Effect    = "Deny",
        Principal = "*",
        Action    = "s3:*",
        Resource  = [
          "arn:aws:s3:::${local.bucket_name_output}",
          "arn:aws:s3:::${local.bucket_name_output}/*"
        ],
        Condition = {
          NumericLessThan = {
            "s3:TlsVersion" = "1.2"
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "output" {
  count = var.output_bucket == null ? 1 : 0

  bucket = aws_s3_bucket.output[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "output" {
  count = var.output_bucket == null && var.output_bucket_lifecycle != null ? 1 : 0

  bucket = aws_s3_bucket.output[0].id

  rule {
    id     = var.output_bucket_lifecycle.id
    status = var.output_bucket_lifecycle.enabled ? "Enabled" : "Disabled"
    expiration {
      days = var.output_bucket_lifecycle.expiration_days
    }
  }
}

resource "aws_s3_bucket_public_access_block" "output" {
  count = var.output_bucket == null ? 1 : 0

  bucket = aws_s3_bucket.output[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

#################################
#  aws_s3_object : config_file
#################################

resource "aws_s3_object" "config_file" {
  bucket       = var.config_bucket != null ? var.config_bucket.id : aws_s3_bucket.config[0].id
  key          = "azure.json"
  source       = var.azure_config_file
  source_hash  = filemd5(var.azure_config_file)
  content_type = "application/json"

  tags = var.tags
}
