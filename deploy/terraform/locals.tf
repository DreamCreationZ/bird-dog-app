locals {
  azs = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available.names, 0, length(var.public_subnet_cidrs))

  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = {
    NamePrefix = local.name_prefix
  }

  ssm_parameter_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(var.ssm_env_parameter_name, "/")}"
}
