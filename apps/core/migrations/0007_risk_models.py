from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_testplanscope"),
    ]

    operations = [
        migrations.CreateModel(
            name="Risk",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
            ],
            options={
                "ordering": ["title", "id"],
            },
        ),
        migrations.CreateModel(
            name="MitigationPlan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
            ],
            options={
                "ordering": ["title", "id"],
            },
        ),
        migrations.CreateModel(
            name="RiskAndMitigationPlan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("impact", models.TextField(blank=True)),
                (
                    "mitigation_plan",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="risk_links",
                        to="core.mitigationplan",
                    ),
                ),
                (
                    "risk",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mitigation_links",
                        to="core.risk",
                    ),
                ),
            ],
            options={
                "ordering": ["risk", "mitigation_plan", "id"],
                "unique_together": {("risk", "mitigation_plan")},
            },
        ),
    ]
