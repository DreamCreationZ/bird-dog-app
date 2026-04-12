variable "project_name" {
  description = "Project tag/name prefix."
  type        = string
  default     = "bird-dog"
}

variable "environment" {
  description = "Environment name for tagging."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region to deploy infrastructure into."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR for VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs (must match availability zones count you want to use)."
  type        = list(string)
  default     = ["10.40.0.0/24", "10.40.1.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) >= 2
    error_message = "At least two public subnet CIDRs are required for multi-AZ ALB."
  }
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs for app Auto Scaling Group."
  type        = list(string)
  default     = ["10.40.10.0/24", "10.40.11.0/24"]
}

variable "availability_zones" {
  description = "Optional explicit AZ list. Leave empty to auto-pick first N available AZs."
  type        = list(string)
  default     = []
}

variable "domain_name" {
  description = "Public app domain, for example app.example.edu."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN in the same region as the ALB."
  type        = string

  validation {
    condition     = length(trimspace(var.certificate_arn)) > 0
    error_message = "certificate_arn must be set."
  }
}

variable "create_dns_record" {
  description = "Create Route53 alias record for domain_name -> ALB."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Route53 hosted zone id, required only when create_dns_record=true."
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "EC2 app instance size."
  type        = string
  default     = "t3.large"
}

variable "key_name" {
  description = "Optional EC2 SSH key pair name."
  type        = string
  default     = ""
}

variable "desired_capacity" {
  description = "Desired app instances."
  type        = number
  default     = 2
}

variable "min_size" {
  description = "Minimum app instances."
  type        = number
  default     = 2
}

variable "max_size" {
  description = "Maximum app instances."
  type        = number
  default     = 8
}

variable "app_port" {
  description = "Port Next.js app listens on."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "ALB target group health check path."
  type        = string
  default     = "/api/health"
}

variable "ssh_cidr_blocks" {
  description = "Optional CIDRs allowed to SSH to instances."
  type        = list(string)
  default     = []
}

variable "repo_url" {
  description = "Git repository URL the instances can clone/pull."
  type        = string

  validation {
    condition     = length(trimspace(var.repo_url)) > 0
    error_message = "repo_url must be set."
  }
}

variable "repo_branch" {
  description = "Repository branch to deploy on instances."
  type        = string
  default     = "main"
}

variable "ssm_env_parameter_name" {
  description = "SSM Parameter Store SecureString name containing /etc/bird-dog/.env.production content."
  type        = string

  validation {
    condition     = length(trimspace(var.ssm_env_parameter_name)) > 0
    error_message = "ssm_env_parameter_name must be set."
  }
}

variable "ssm_kms_key_arn" {
  description = "Optional KMS key ARN used to encrypt the SecureString parameter."
  type        = string
  default     = ""
}

variable "cpu_target_value" {
  description = "Target average CPU utilization for ASG target tracking."
  type        = number
  default     = 55
}
