output "vpc_id" {
  value       = aws_vpc.main.id
  description = "Created VPC id."
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Public subnet ids."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet ids."
}

output "alb_dns_name" {
  value       = aws_lb.app.dns_name
  description = "ALB DNS name."
}

output "app_url" {
  value       = "https://${var.domain_name}"
  description = "Expected app URL."
}

output "autoscaling_group_name" {
  value       = aws_autoscaling_group.app.name
  description = "App ASG name."
}

output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "ALB target group ARN."
}
