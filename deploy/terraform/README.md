# Terraform Setup (AWS)

This stack creates production infrastructure for Bird Dog on AWS:
- VPC with public + private subnets
- Internet/NAT routing
- Application Load Balancer (HTTPS)
- Auto Scaling Group of EC2 instances in private subnets
- IAM role/profile for EC2 (SSM + CloudWatch agent policy)
- Bootstrap script that installs Node/PM2, deploys app, and runs web + worker

## Prerequisites

- Terraform `>= 1.6`
- AWS credentials configured (`aws configure` or SSO)
- ACM certificate already issued in the same region
- Repo URL accessible from EC2 instances
- SSM Parameter Store `SecureString` containing production `.env` content

## 1) Create SSM parameter for env file

```bash
aws ssm put-parameter \
  --name "/bird-dog/prod/env" \
  --type "SecureString" \
  --value "$(cat deploy/ec2/env.production.example)" \
  --overwrite
```

Replace that value with your real production env content before first apply.

## 2) Create tfvars

```bash
cd /Users/swati/Documents/bird-dog-app/deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

Set at minimum:
- `domain_name`
- `certificate_arn`
- `repo_url`
- `ssm_env_parameter_name`
- `ssm_kms_key_arn` only if your parameter uses a customer-managed KMS key

## 3) Initialize and deploy

```bash
cd /Users/swati/Documents/bird-dog-app/deploy/terraform
terraform init
terraform plan
terraform apply
```

## 4) Verify

After apply:
- point DNS to ALB (or set `create_dns_record = true` with zone id)
- wait for ASG instances to pass ALB health check on `/api/health`
- open `https://<domain_name>/login`

## Notes

- App instances run in private subnets; only ALB is public.
- SSH is disabled by default. If needed, set `key_name` and `ssh_cidr_blocks`.
- Bootstrap uses `deploy/ec2/ecosystem.config.cjs` and `/etc/bird-dog/.env.production`.
- For private GitHub repos, use an instance-accessible URL/token strategy before first boot.
