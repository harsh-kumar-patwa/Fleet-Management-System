#!/bin/bash
# Deletes everything setup.sh created (run AFTER taking all screenshots).  bash cleanup.sh
set -uo pipefail
source ~/a2-state.env || { echo "~/a2-state.env not found"; exit 1; }
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""
log(){ echo -e "\n\033[1;33m==> $*\033[0m"; }

log "Elastic Beanstalk"
aws elasticbeanstalk terminate-environment --environment-name PaaS-Web-App-env >/dev/null 2>&1
aws elasticbeanstalk wait environment-terminated --application-name PaaS-Web-App --environment-names PaaS-Web-App-env 2>/dev/null
aws elasticbeanstalk delete-application --application-name PaaS-Web-App --terminate-env-by-force 2>/dev/null

log "CloudWatch alarm + SNS"
aws cloudwatch delete-alarms --alarm-names High-CPU-Web-Server-1
aws sns delete-topic --topic-arn "$TOPIC"

log "RDS (no final snapshot)"
aws rds delete-db-instance --db-instance-identifier app-database --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1
aws rds wait db-instance-deleted --db-instance-identifier app-database
aws rds delete-db-subnet-group --db-subnet-group-name app-db-subnet-group

log "ALB, target group, instances"
aws elbv2 delete-load-balancer --load-balancer-arn "$ALB"
aws elbv2 wait load-balancers-deleted --load-balancer-arns "$ALB"
sleep 10; aws elbv2 delete-target-group --target-group-arn "$TG"
aws ec2 terminate-instances --instance-ids "$WS1" "$WS2" >/dev/null
aws ec2 wait instance-terminated --instance-ids "$WS1" "$WS2"

log "Peering + routes"
aws ec2 delete-route --route-table-id "$WEB_RT" --destination-cidr-block 10.1.0.0/16
aws ec2 delete-vpc-peering-connection --vpc-peering-connection-id "$PCX" >/dev/null

log "Security groups"
sleep 20
for sg in "$WEB_SG" "$ALB_SG" "$DB_SG"; do aws ec2 delete-security-group --group-id "$sg" || echo "retry later: $sg"; done

log "Database-VPC"
for s in "$PRIV1" "$PRIV2"; do aws ec2 delete-subnet --subnet-id "$s"; done
aws ec2 delete-route-table --route-table-id "$DB_RT"
aws ec2 delete-vpc --vpc-id "$DB_VPC"

if [ "${CREATED_WEB_VPC:-}" = "yes" ]; then
  log "Cloud-Assignment-VPC (created by setup.sh)"
  for s in "$PUB1" "$PUB2"; do aws ec2 delete-subnet --subnet-id "$s"; done
  aws ec2 delete-route-table --route-table-id "$WEB_RT"
  aws ec2 detach-internet-gateway --internet-gateway-id "$IGW" --vpc-id "$WEB_VPC"
  aws ec2 delete-internet-gateway --internet-gateway-id "$IGW"
  aws ec2 delete-vpc --vpc-id "$WEB_VPC"
fi
log "Cleanup finished. Check Billing > Bills next day to confirm no running charges."
