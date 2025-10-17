from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_testplan_objectives"),
    ]

    operations = [
        migrations.CreateModel(
            name="TestPlanScope",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("category", models.CharField(choices=[("in_scope", "In Scope"), ("out_scope", "Out of Scope")], max_length=20)),
                ("item", models.CharField(max_length=255)),
                ("order", models.PositiveIntegerField(default=0)),
                ("plan", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="scopes", to="core.testplan")),
            ],
            options={
                "ordering": ["plan", "category", "order", "id"],
            },
        ),
    ]
