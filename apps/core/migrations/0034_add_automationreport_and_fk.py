from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_alter_apirunresultreport_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationReport",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("report_id", models.CharField(max_length=12, unique=True, blank=True)),
                ("triggered_in", models.CharField(max_length=500, blank=True)),
                (
                    "triggered_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="automation_reports",
                        to=settings.AUTH_USER_MODEL,
                        null=True,
                        blank=True,
                    ),
                ),
                ("total_passed", models.PositiveIntegerField(default=0)),
                ("total_failed", models.PositiveIntegerField(default=0)),
                ("total_blocked", models.PositiveIntegerField(default=0)),
                ("started", models.DateTimeField(blank=True, null=True)),
                ("finished", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "ordering": ["-created_at", "id"],
            },
        ),
        migrations.AddField(
            model_name="apirunresultreport",
            name="automation_report",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='result_reports', to='core.automationreport'),
        ),
    ]