# Cloud Computing Assignment 2: Run Guide

## Step 0: Secure your account (do this first)
1. Change your root password: account menu → **Security credentials** → **Update password**.
2. Turn on **MFA** for root on the same page.

## Step 1: Run the setup (about 20 minutes)
1. Log in to the AWS console and set the region (top right) to **N. Virginia (us-east-1)**.
2. Click the **CloudShell** icon `>_` in the top bar.
3. Click **Actions → Upload file**, then upload `setup.sh` and `cleanup.sh`.
4. Run this, using your own email:
   ```bash
   EMAIL=your-email@example.com bash setup.sh
   ```
5. While it runs, open your inbox and click **Confirm subscription** in the email from AWS Notifications.
6. At the end it prints the Beanstalk URL, the ALB DNS name, the RDS endpoint and the DB password. Copy them somewhere.

> If it stops with an instance-type error, re-run it with `INSTANCE_TYPE=t2.micro EMAIL=... bash setup.sh`. It's safe to re-run: anything that already exists is reused.

## Step 2: Screenshots checklist

| # | Section | Where to go | What it must show |
|---|---|---|---|
| 1 | S1 | Elastic Beanstalk → Environments → **PaaS-Web-App-env** | Health **Ok** (green) |
| 2 | S1 | Open the Beanstalk URL in a browser | Node.js sample "Congratulations" page, with the URL visible |
| 3 | S1 (extra) | EC2 → Instances / Auto Scaling Groups / Load Balancers | The `awseb-...` resources Beanstalk created for you |
| 4 | S2 | EC2 → Target Groups → **Web-Target-Group** → Targets | Both servers **healthy** |
| 5 | S2 | EC2 → Load Balancers → **App-ALB** | Details showing the **DNS name** |
| 6 | S2 | Browser at `http://<ALB DNS>`: refresh | **Server 1** |
| 7 | S2 | Same URL, refresh again | **Server 2** |
| 8 | S3 | VPC → Peering connections → **App-DB-Peering** | Status **Active** |
| 9 | S3 | VPC → Route tables → Web VPC public route table → Routes | `10.1.0.0/16 → pcx-...` |
| 10 | S3 | VPC → Route tables → **Database-Private-RT** → Routes | `10.0.0.0/16 → pcx-...` |
| 11 | S3 | EC2 → Web-Server-1 → **Connect** → EC2 Instance Connect → run the two commands the script printed | `Connected to ... 3306` and the MySQL version output |
| 12 | S3 (extra) | RDS → Databases → **app-database** → Connectivity | Publicly accessible **No**, in Database-VPC |
| 13 | S4 | SNS → Topics → **Server-Alerts** → Subscriptions | Status **Confirmed** |
| 14 | S4 | CloudWatch → Alarms → **High-CPU-Web-Server-1** | Threshold `CPUUtilization > 70`, action → Server-Alerts |

**Tips**
- **ALB keeps showing the same server:** browsers reuse connections. Press **Ctrl+Shift+R**, or use a new incognito window for each refresh. You can also run this in CloudShell to show it alternating: `for i in 1 2 3 4 5 6; do curl -s http://<ALB-DNS>/ | grep -o "Server [12]"; done`.
- **Optional (to show the alarm firing):** on Web-Server-1 run `sudo dnf install -y stress-ng && stress-ng --cpu 2 --timeout 600`. The alarm goes to **In alarm** within about 5–10 minutes and you get an email.
- **Health stuck on "Pending":** wait 1–2 minutes and refresh.

## Step 3: Clean up (same day)
Once all screenshots are taken, run this in CloudShell:
```bash
bash cleanup.sh
```
The ALB, public IPv4 addresses and Beanstalk's load balancer are billed by the hour. Done the same day, the total should be well under $1.

---

## Written answer: Section 1, Q1 (copy into your submission)

### IaaS vs PaaS vs SaaS

| Aspect | IaaS | PaaS | SaaS |
|---|---|---|---|
| **AWS example** | Amazon EC2 (plus VPC, EBS) | AWS Elastic Beanstalk | Amazon WorkMail / Amazon SES / Amazon SNS |
| **What you get** | Virtual servers, storage, networking | A ready platform to run your code | A finished application or service you just use |
| **You manage** | OS, patches, runtime, web server, app, scaling, load balancing | Only your application code and its configuration | Only your data, users and settings |
| **AWS manages** | Physical hardware, hypervisor, data centre | Plus the OS, runtime, EC2 provisioning, Auto Scaling, load balancer, health monitoring | Everything: infrastructure, platform and software |
| **Control / flexibility** | Highest: any OS or software | Medium: limited to the supported platforms (Node.js, Python, PHP…) | Lowest: you use the features provided |
| **Effort to deploy** | High: set up and configure manually (like Section 2) | Low: upload code and it's deployed (like Section 1) | None: sign up, configure, use (like Section 4) |
| **Scaling** | You configure ASG and ELB yourself | Built in, set through options | Automatic and invisible to you |
| **Billing** | Per instance-hour / second | No charge for Beanstalk itself; you pay for the EC2, ELB etc. it creates | Per use (per mailbox, per email, per notification) |
| **Best for** | Custom stacks, legacy apps, full control | Web apps and APIs where you want to focus on code | Standard business functions (email, notifications) |

**Summary:** going from IaaS to PaaS to SaaS, AWS takes on more of the management work and you give up some control. In this assignment, Section 2 is IaaS: I launched and configured EC2, the target group and the ALB by hand. Section 1 is PaaS: Elastic Beanstalk automatically provisioned the same EC2, Auto Scaling and load balancer components from a single "create environment" step. Section 4 is SaaS: SNS delivers email alerts with no servers to manage.
