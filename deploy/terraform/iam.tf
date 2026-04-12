data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.name_prefix}-app-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-app-role"
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

data "aws_iam_policy_document" "ssm_env_read" {
  statement {
    sid       = "ReadBirdDogEnvParameter"
    actions   = ["ssm:GetParameter"]
    resources = [local.ssm_parameter_arn]
  }

  dynamic "statement" {
    for_each = var.ssm_kms_key_arn != "" ? [var.ssm_kms_key_arn] : []
    content {
      sid       = "DecryptSsmEnvParameterKmsKey"
      actions   = ["kms:Decrypt"]
      resources = [statement.value]
    }
  }
}

resource "aws_iam_role_policy" "ssm_env_read" {
  name   = "${local.name_prefix}-ssm-env-read"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.ssm_env_read.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${local.name_prefix}-app-instance-profile"
  role = aws_iam_role.app.name
}
